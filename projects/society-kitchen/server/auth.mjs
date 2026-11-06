// Phone + one-time-code sign-in and cookie sessions.
//
// Rules this module enforces:
//  - Codes are 6 random digits, valid 10 minutes, stored only as an HMAC.
//  - A new code cancels any older unused one.
//  - At most 5 wrong tries per code; then it is dead.
//  - A code works once (the "consume" step is atomic, so two simultaneous
//    submissions of the right code cannot both log in).
//  - Asking for a code never reveals whether the number already has an account.
//  - Per number: at least 30 s between codes, at most 5 per hour. Per IP: capped too.
//  - Session tokens are 256 random bits, stored only as a SHA-256 hash, revocable.
import crypto from 'node:crypto';
import { createLimiter } from './ratelimit.mjs';

export const OTP_TTL_S = 600;
export const RESEND_S = 30;
export const MAX_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;
export const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(status, code, detail = {}) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

// Returns E.164 (+<country><number>) or null.
export function normalizePhone(input) {
  const raw = String(input ?? '').replace(/[\s\-().]/g, '');
  if (/^\+91[6-9]\d{9}$/.test(raw)) return raw;
  if (/^91[6-9]\d{9}$/.test(raw)) return `+${raw}`;
  if (/^0?[6-9]\d{9}$/.test(raw)) return `+91${raw.slice(-10)}`;
  if (/^\+[1-9]\d{7,14}$/.test(raw) && !raw.startsWith('+91')) return raw;
  return null;
}

export function createAuth({ pool, secret, send, ipLimiter = createLimiter({ windowMs: 3600e3, max: 30 }) }) {
  if (!secret || secret.length < 16) throw new Error('AUTH_SECRET must be at least 16 characters');
  const codeHash = (phone, code) => crypto.createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const q = async (sql, params) => (await pool.query(sql, params)).rows;

  async function requestOtp(phoneInput, ip = '?') {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new AuthError(400, 'invalid_phone');
    const hit = ipLimiter.hit(ip);
    if (!hit.ok) throw new AuthError(429, 'otp_rate_limited', { retry_after: Math.ceil(hit.retryAfterMs / 1000) });

    const [recent] = await q(
      `select count(*) filter (where created_at > now() - interval '1 hour')::int as in_hour,
              extract(epoch from (now() - max(created_at))) as since
         from otp_challenges where phone = $1`, [phone]);
    if (recent.since !== null && recent.since < RESEND_S) {
      throw new AuthError(429, 'otp_too_soon', { retry_after: Math.ceil(RESEND_S - recent.since) });
    }
    if (recent.in_hour >= MAX_PER_HOUR) throw new AuthError(429, 'otp_rate_limited', { retry_after: 3600 });

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await q(`update otp_challenges set consumed_at = now() where phone = $1 and consumed_at is null`, [phone]);
    const [ch] = await q(
      `insert into otp_challenges (phone, code_hash, expires_at)
       values ($1, $2, now() + make_interval(secs => $3)) returning id`, [phone, codeHash(phone, code), OTP_TTL_S]);
    try {
      await send(phone, code);
    } catch (e) {
      await q('delete from otp_challenges where id = $1', [ch.id]);
      console.error('Sending the code failed:', e.message);
      throw new AuthError(502, 'otp_send_failed');
    }
    // Housekeeping: forget old, finished challenges and sessions.
    q(`delete from otp_challenges where created_at < now() - interval '1 day'`).catch(() => {});
    q(`delete from sessions where expires_at < now() - interval '1 day' or revoked_at < now() - interval '1 day'`).catch(() => {});
    return { ok: true, expires_in: OTP_TTL_S, resend_after: RESEND_S };
  }

  async function verifyOtp(phoneInput, code, userAgent = '') {
    const phone = normalizePhone(phoneInput);
    if (!phone || !/^\d{6}$/.test(String(code ?? ''))) throw new AuthError(401, 'otp_invalid');

    // Count this try and fetch the newest live code in one atomic step.
    const [ch] = await q(
      `update otp_challenges set attempts = attempts + 1
        where id = (select id from otp_challenges
                     where phone = $1 and consumed_at is null and expires_at > now()
                     order by created_at desc limit 1)
        returning id, code_hash, attempts`, [phone]);
    if (!ch) throw new AuthError(401, 'otp_invalid');
    const kill = () => q('update otp_challenges set consumed_at = now() where id = $1 and consumed_at is null', [ch.id]);
    if (ch.attempts > MAX_ATTEMPTS) { await kill(); throw new AuthError(429, 'too_many_attempts'); }

    const good = crypto.timingSafeEqual(Buffer.from(ch.code_hash, 'hex'), Buffer.from(codeHash(phone, String(code)), 'hex'));
    if (!good) {
      if (ch.attempts >= MAX_ATTEMPTS) { await kill(); throw new AuthError(429, 'too_many_attempts'); }
      throw new AuthError(401, 'otp_invalid', { attempts_left: MAX_ATTEMPTS - ch.attempts });
    }

    // Single use: only one concurrent request can flip consumed_at.
    const won = await q('update otp_challenges set consumed_at = now() where id = $1 and consumed_at is null returning id', [ch.id]);
    if (!won.length) throw new AuthError(401, 'otp_invalid');

    const [acct] = await q(
      `insert into accounts (phone, last_login_at) values ($1, now())
       on conflict (phone) do update set last_login_at = now() returning id`, [phone]);
    const token = crypto.randomBytes(32).toString('base64url');
    await q(
      `insert into sessions (token_hash, account_id, expires_at, user_agent)
       values ($1, $2, now() + make_interval(days => $3), $4)`, [sha(token), acct.id, SESSION_DAYS, String(userAgent).slice(0, 200)]);
    return { token, accountId: acct.id };
  }

  async function sessionAccount(token) {
    if (!token || token.length < 20) return null;
    const [s] = await q(`select account_id from sessions where token_hash = $1 and revoked_at is null and expires_at > now()`, [sha(token)]);
    return s ? s.account_id : null;
  }

  async function revoke(token) {
    if (token) await q('update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [sha(token)]);
  }

  return { requestOtp, verifyOtp, sessionAccount, revoke };
}
