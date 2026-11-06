// Sign-in with society invite code + name + flat + PIN (no SMS).
//
// Honest limits: anyone who has the invite code can join, and can register under
// any name that is not taken. The PIN stops a neighbour from signing in as someone
// who already registered, and lets people return on a new phone. If the code leaks,
// change it in the database (see docs/DEPLOY.md).
//
// Rules: PIN is 6 digits, stored as a salted scrypt hash; 5 wrong PINs lock the
// account for 15 minutes; per-IP caps on both sign-up and sign-in; the error for
// "no such resident" and "wrong PIN" is identical.
import crypto from 'node:crypto';
import { createLimiter } from './ratelimit.mjs';
import { AuthError, SESSION_DAYS } from './auth.mjs';

export const MAX_PIN_FAILS = 5;
export const LOCK_MINUTES = 15;

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const loginKey = (societyId, name, flat) => `${societyId}|${norm(flat).replace(/[^a-z0-9]/g, '')}|${norm(name)}`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}
function checkPin(pin, stored) {
  const [salt, hash] = String(stored ?? '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
const DUMMY = hashPin('000000'); // so unknown residents take as long as known ones

export function createPinAuth({ pool, withUser, ipLimiter = createLimiter({ windowMs: 3600e3, max: 30 }) }) {
  const q = async (sql, params) => (await pool.query(sql, params)).rows;

  async function society(code) {
    const [s] = await q('select id from societies where lower(invite_code) = lower(trim($1))', [String(code ?? '')]);
    return s;
  }
  function validate({ display_name, flat_label, pin }) {
    const name = String(display_name ?? '').trim(), flat = String(flat_label ?? '').trim();
    if (!name || name.length > 60 || !flat || flat.length > 20) throw new AuthError(400, 'invalid_value');
    if (!/^\d{6}$/.test(String(pin ?? ''))) throw new AuthError(400, 'invalid_pin');
    return { name, flat, pin: String(pin) };
  }
  async function newSession(accountId, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    await q(`insert into sessions (token_hash, account_id, expires_at, user_agent)
             values ($1, $2, now() + make_interval(days => $3), $4)`, [sha(token), accountId, SESSION_DAYS, String(userAgent ?? '').slice(0, 200)]);
    return token;
  }
  const limit = (ip) => {
    const h = ipLimiter.hit(ip);
    if (!h.ok) throw new AuthError(429, 'otp_rate_limited', { retry_after: Math.ceil(h.retryAfterMs / 1000) });
  };

  async function signup(body, ip, userAgent) {
    limit(ip);
    const { name, flat, pin } = validate(body);
    const soc = await society(body.invite_code);
    if (!soc) throw new AuthError(400, 'invalid_invite_code');
    const key = loginKey(soc.id, name, flat);
    const [acct] = await q(
      `insert into accounts (login_key, pin_hash, last_login_at) values ($1, $2, now())
       on conflict (login_key) do nothing returning id`, [key, hashPin(pin)]);
    if (!acct) throw new AuthError(409, 'already_registered');
    try {
      await withUser(acct.id, (c) => c.query('select * from join_society($1, $2, $3)', [body.invite_code, name, flat]));
    } catch (e) {
      await q('delete from accounts where id = $1', [acct.id]);
      throw e;
    }
    return { accountId: acct.id, token: await newSession(acct.id, userAgent) };
  }

  async function login(body, ip, userAgent) {
    limit(ip);
    const { name, flat, pin } = validate(body);
    const soc = await society(body.invite_code);
    const [acct] = soc ? await q('select id, pin_hash, locked_until from accounts where login_key = $1', [loginKey(soc.id, name, flat)]) : [];
    if (!acct) { checkPin(pin, DUMMY); throw new AuthError(401, 'invalid_credentials'); }
    // Count this try, and lock on the 5th, in one atomic statement, so parallel
    // guesses cannot get past the limit. Skipped entirely while locked.
    const [t] = await q(
      `update accounts set
         failed_pins  = case when failed_pins + 1 >= $2 then 0 else failed_pins + 1 end,
         locked_until = case when failed_pins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
       where id = $1 and (locked_until is null or locked_until <= now())
       returning failed_pins, (locked_until > now()) as locked_now`, [acct.id, MAX_PIN_FAILS, LOCK_MINUTES]);
    if (!t) throw new AuthError(429, 'account_locked', { retry_after: LOCK_MINUTES * 60 });
    if (!checkPin(pin, acct.pin_hash)) {
      if (t.locked_now) throw new AuthError(429, 'account_locked', { retry_after: LOCK_MINUTES * 60 });
      throw new AuthError(401, 'invalid_credentials', { attempts_left: MAX_PIN_FAILS - t.failed_pins });
    }
    await q('update accounts set failed_pins = 0, locked_until = null, last_login_at = now() where id = $1', [acct.id]);
    return { accountId: acct.id, token: await newSession(acct.id, userAgent) };
  }

  return { signup, login };
}
