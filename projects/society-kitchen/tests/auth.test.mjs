// Sign-in logic against a real Postgres (no HTTP). Needs a superuser URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '../lib/minipg.mjs';
import { createAuth, normalizePhone, AuthError, MAX_ATTEMPTS } from '../server/auth.mjs';
import { createLimiter } from '../server/ratelimit.mjs';
import { createSender } from '../server/sms.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.ADMIN_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_auth';
const dbUrl = `${ADMIN_URL.replace(/\/[^/]*$/, '')}/${DB}`;
const PHONE = '+919811122233';

let pool, auth, outbox;
const lastCode = () => outbox.at(-1).code;
const wrong = (c) => (c === '000000' ? '111111' : '000000');
const fails = async (p, code, status) => {
  await assert.rejects(p, (e) => e instanceof AuthError && e.code === code && (!status || e.status === status), `expected ${code}`);
};
const freshAuth = () => createAuth({ pool, secret: 'test-secret-0123456789', send: async (phone, code) => { outbox.push({ phone, code }); } });
const clearGap = (phone = PHONE) => pool.query(`update otp_challenges set created_at = created_at - interval '1 minute' where phone = $1`, [phone]);

before(async () => {
  execFileSync('bash', [path.join(ROOT, 'scripts/setup.sh')], { env: { ...process.env, DB, ADMIN_URL }, stdio: 'pipe' });
  pool = new Pool({ connectionString: dbUrl, max: 5 });
  outbox = []; auth = freshAuth();
});
after(async () => { await pool?.end(); });

test('phone numbers are normalised; junk is rejected', () => {
  assert.equal(normalizePhone('98765 43210'), '+919876543210');
  assert.equal(normalizePhone('+91 98765-43210'), '+919876543210');
  assert.equal(normalizePhone('09876543210'), '+919876543210');
  assert.equal(normalizePhone('919876543210'), '+919876543210');
  for (const bad of ['12345', '5876543210', 'abc', '', null, '+91 12345 67890']) assert.equal(normalizePhone(bad), null, String(bad));
});

test('a new number can sign in with the right code, once', async () => {
  await auth.requestOtp(PHONE);
  assert.equal(outbox.length, 1); assert.match(lastCode(), /^\d{6}$/);
  const { token, accountId } = await auth.verifyOtp(PHONE, lastCode(), 'test');
  assert.ok(token.length >= 40);
  assert.equal(await auth.sessionAccount(token), accountId);
  await fails(auth.verifyOtp(PHONE, lastCode()), 'otp_invalid', 401); // reuse
});

test('wrong code is refused and counts down; the 5th wrong try kills the code', async () => {
  await clearGap(); await auth.requestOtp(PHONE);
  const good = lastCode();
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    await assert.rejects(auth.verifyOtp(PHONE, wrong(good)), (e) => e.code === 'otp_invalid' && e.detail.attempts_left === MAX_ATTEMPTS - i);
  }
  await fails(auth.verifyOtp(PHONE, wrong(good)), 'too_many_attempts', 429);
  await fails(auth.verifyOtp(PHONE, good), 'otp_invalid'); // even the right code is now dead
});

test('expired code is refused', async () => {
  await clearGap(); await auth.requestOtp(PHONE);
  await pool.query(`update otp_challenges set expires_at = now() - interval '1 second' where phone = $1 and consumed_at is null`, [PHONE]);
  await fails(auth.verifyOtp(PHONE, lastCode()), 'otp_invalid');
});

test('a new code cancels the older one', async () => {
  await clearGap(); await auth.requestOtp(PHONE); const first = lastCode();
  await clearGap(); await auth.requestOtp(PHONE); const second = lastCode();
  if (first !== second) await fails(auth.verifyOtp(PHONE, first), 'otp_invalid');
  await auth.verifyOtp(PHONE, second);
});

test('asking again within 30 s is refused; 5 per hour cap', async () => {
  const p = '+919822200001';
  await auth.requestOtp(p);
  await assert.rejects(auth.requestOtp(p), (e) => e.code === 'otp_too_soon' && e.status === 429 && e.detail.retry_after > 0);
  for (let i = 0; i < 4; i++) { await clearGap(p); await auth.requestOtp(p); }
  await clearGap(p);
  await fails(auth.requestOtp(p), 'otp_rate_limited', 429);
});

test('per-IP cap applies across numbers', async () => {
  const a = createAuth({ pool, secret: 'test-secret-0123456789', send: async () => {}, ipLimiter: createLimiter({ windowMs: 60e3, max: 2 }) });
  await a.requestOtp('+919833300001', '9.9.9.9'); await a.requestOtp('+919833300002', '9.9.9.9');
  await fails(a.requestOtp('+919833300003', '9.9.9.9'), 'otp_rate_limited', 429);
  await a.requestOtp('+919833300003', '8.8.8.8');
});

test('two simultaneous submissions of the right code: exactly one logs in', async () => {
  const p = '+919844400001';
  await auth.requestOtp(p); const code = lastCode();
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => auth.verifyOtp(p, code)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  const [{ n }] = (await pool.query(`select count(*)::int n from sessions s join accounts a on a.id = s.account_id where a.phone = $1`, [p])).rows;
  assert.equal(n, 1);
});

test('sessions: revoke and expiry end them; garbage is refused', async () => {
  const p = '+919855500001';
  await auth.requestOtp(p); const { token } = await auth.verifyOtp(p, lastCode());
  assert.ok(await auth.sessionAccount(token));
  await auth.revoke(token);
  assert.equal(await auth.sessionAccount(token), null);
  await clearGap(p); await auth.requestOtp(p); const s2 = await auth.verifyOtp(p, lastCode());
  await pool.query(`update sessions set expires_at = now() - interval '1 second'`);
  assert.equal(await auth.sessionAccount(s2.token), null);
  for (const junk of ['', 'x', null, 'a'.repeat(50)]) assert.equal(await auth.sessionAccount(junk), null);
});

test('no plaintext code or token is stored', async () => {
  const p = '+919866600001';
  await auth.requestOtp(p); const code = lastCode();
  const { token } = await auth.verifyOtp(p, code);
  const dump = JSON.stringify([(await pool.query('select * from otp_challenges')).rows, (await pool.query('select * from sessions')).rows]);
  assert.ok(!dump.includes(token)); assert.ok(!dump.includes(`"${code}"`));
});

test('a failed SMS leaves no usable code and reports an error', async () => {
  const p = '+919877700001';
  const bad = createAuth({ pool, secret: 'test-secret-0123456789', send: async () => { throw new Error('gateway down'); } });
  const orig = console.error; console.error = () => {};
  try { await fails(bad.requestOtp(p), 'otp_send_failed', 502); } finally { console.error = orig; }
  assert.equal((await pool.query('select count(*)::int n from otp_challenges where phone = $1', [p])).rows[0].n, 0);
  await auth.requestOtp(p); // not blocked by the failed attempt
});

test('responses do not reveal whether a number has an account', async () => {
  const known = '+919000000001', unknown = '+919888800099';
  const a = await auth.requestOtp(known), b = await auth.requestOtp(unknown);
  assert.deepEqual(a, b);
  await fails(auth.verifyOtp(known, '123456'), 'otp_invalid');
  await fails(auth.verifyOtp('+919888800098', '123456'), 'otp_invalid');
});

test('auth tables are unreadable to the app roles', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await assert.rejects(c.query('select * from sessions'), /permission denied/);
    await c.query('rollback');
    await c.query('begin'); await c.query('set local role anon');
    await assert.rejects(c.query('select * from otp_challenges'), /permission denied/);
    await c.query('rollback');
  } finally { c.release(); }
});

test('limiter slides', () => {
  let t = 0; const l = createLimiter({ windowMs: 1000, max: 2, now: () => t });
  assert.ok(l.hit('k').ok); assert.ok(l.hit('k').ok);
  const r = l.hit('k'); assert.ok(!r.ok); assert.ok(r.retryAfterMs > 0);
  assert.ok(l.hit('other').ok);
  t = 1001; assert.ok(l.hit('k').ok);
});

test('webhook sender posts phone + message; errors surface', async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got.push(JSON.parse(b)); res.writeHead(got.length > 1 ? 500 : 200); res.end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/sms`;
  const send = createSender({ provider: 'webhook', webhookUrl: url });
  await send('+919000000001', '654321');
  assert.equal(got[0].phone, '+919000000001'); assert.match(got[0].message, /^654321 is your/);
  await assert.rejects(send('+919000000001', '1'), /answered 500/);
  srv.close();
  assert.throws(() => createSender({ provider: 'webhook' }), /OTP_WEBHOOK_URL/);
  assert.throws(() => createSender({ provider: 'carrier-pigeon' }), /Unknown/);
});
