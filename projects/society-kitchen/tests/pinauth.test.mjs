// Link + PIN sign-in against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '../lib/minipg.mjs';
import { createPinAuth, MAX_PIN_FAILS } from '../server/pinauth.mjs';
import { createAuth, AuthError } from '../server/auth.mjs';
import { createLimiter } from '../server/ratelimit.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.ADMIN_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_pin';
let pool, pa, auth;

// Same shape as the server's withUser: a transaction as that user, under RLS.
async function withUser(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);
    await c.query('set local role authenticated');
    const r = await fn(c); await c.query('commit'); return r;
  } catch (e) { try { await c.query('rollback'); } catch {} throw e; } finally { c.release(); }
}
const fails = (p, code, status) => assert.rejects(p, (e) => e instanceof AuthError && e.code === code && (!status || e.status === status), `expected ${code}`);
const who = (o = {}) => ({ invite_code: 'HARMONY-123', display_name: 'Priya Nair', flat_label: 'D-501', pin: '482916', ...o });

before(async () => {
  execFileSync('bash', [path.join(ROOT, 'scripts/setup.sh')], { env: { ...process.env, DB, ADMIN_URL }, stdio: 'pipe' });
  pool = new Pool({ connectionString: `${ADMIN_URL.replace(/\/[^/]*$/, '')}/${DB}`, max: 5 });
  pa = createPinAuth({ pool, withUser, ipLimiter: createLimiter({ windowMs: 3600e3, max: 1000 }) });
  auth = createAuth({ pool, secret: 'test-secret-0123456789', send: async () => {} });
});
after(async () => { await pool?.end(); });

test('sign up creates an account, a profile in the right society and a session', async () => {
  const { accountId, token } = await pa.signup(who(), '1.1.1.1', 'ua');
  assert.equal(await auth.sessionAccount(token), accountId);
  const [p] = (await pool.query('select p.display_name, p.flat_label, s.name from profiles p join societies s on s.id = p.society_id where p.id = $1', [accountId])).rows;
  assert.deepEqual([p.display_name, p.flat_label, p.name], ['Priya Nair', 'D-501', 'Harmony Residency']);
});

test('invite code is case-insensitive; a wrong one creates nothing', async () => {
  const before = (await pool.query('select count(*)::int n from accounts')).rows[0].n;
  await fails(pa.signup(who({ invite_code: 'NOPE-000', display_name: 'Ghost' }), 'x'), 'invalid_invite_code', 400);
  assert.equal((await pool.query('select count(*)::int n from accounts')).rows[0].n, before);
  await pa.signup(who({ invite_code: ' lake-456 ', display_name: 'Tara', flat_label: 'T1-2' }), 'x');
  const [{ name }] = (await pool.query(`select s.name from profiles p join societies s on s.id = p.society_id where p.display_name = 'Tara'`)).rows;
  assert.equal(name, 'Lakeview Heights');
});

test('same name + flat cannot be registered twice (also ignoring case, spaces and dashes); other society is separate', async () => {
  await fails(pa.signup(who({ display_name: '  priya   NAIR ', flat_label: 'd 501', pin: '111111' }), 'x'), 'already_registered', 409);
  await pa.signup(who({ invite_code: 'LAKE-456' }), 'x'); // same name+flat in another society is a different resident
});

test('PIN must be exactly 6 digits; name and flat are required', async () => {
  for (const pin of ['12345', '1234567', 'abcdef', '', null]) await fails(pa.signup(who({ display_name: 'Z' + pin, pin }), 'x'), 'invalid_pin', 400);
  await fails(pa.signup(who({ display_name: '' }), 'x'), 'invalid_value', 400);
  await fails(pa.signup(who({ flat_label: ' ' }), 'x'), 'invalid_value', 400);
});

test('sign in works with the right PIN (any case/spacing), not with a wrong one, and errors do not reveal which part was wrong', async () => {
  const ok = await pa.login(who({ display_name: 'PRIYA nair', flat_label: 'D-501' }), 'x', 'ua');
  assert.ok(await auth.sessionAccount(ok.token));
  await assert.rejects(pa.login(who({ pin: '000000' }), 'x'), (e) => e.code === 'invalid_credentials' && e.status === 401 && e.detail.attempts_left === 4);
  const a = await pa.login(who({ display_name: 'Nobody Here' }), 'x').catch((e) => e);
  const b = await pa.login(who({ invite_code: 'NOPE' }), 'x').catch((e) => e);
  assert.equal(a.code, 'invalid_credentials'); assert.equal(b.code, 'invalid_credentials');
  assert.deepEqual(a.detail, {}); assert.deepEqual(b.detail, {}); assert.equal(a.status, b.status);
});

test('5 wrong PINs lock the account, even for the right PIN; an expired lock opens', async () => {
  await pa.signup(who({ display_name: 'Lock Me', flat_label: 'L-1' }), 'x');
  const w = who({ display_name: 'Lock Me', flat_label: 'L-1' });
  for (let i = 1; i < MAX_PIN_FAILS; i++) await assert.rejects(pa.login({ ...w, pin: '999999' }, 'x'), (e) => e.code === 'invalid_credentials');
  await fails(pa.login({ ...w, pin: '999999' }, 'x'), 'account_locked', 429);
  await fails(pa.login(w, 'x'), 'account_locked', 429);
  await pool.query(`update accounts set locked_until = now() - interval '1 second' where login_key like '%|l1|lock me'`);
  assert.ok((await pa.login(w, 'x')).token);
});

test('a correct sign-in resets the failure count', async () => {
  const w = who({ display_name: 'Reset Me', flat_label: 'R-1' });
  await pa.signup(w, 'x');
  for (let i = 0; i < 3; i++) await assert.rejects(pa.login({ ...w, pin: '999999' }, 'x'));
  await pa.login(w, 'x');
  for (let i = 0; i < 4; i++) await assert.rejects(pa.login({ ...w, pin: '999999' }, 'x'), (e) => e.code === 'invalid_credentials');
  assert.ok((await pa.login(w, 'x')).token); // would be locked if the count had not reset
});

test('concurrent wrong guesses cannot exceed the limit', async () => {
  const w = who({ display_name: 'Race Me', flat_label: 'Z-9' });
  await pa.signup(w, 'x');
  const res = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => pa.login({ ...w, pin: String(100000 + i) }, 'x')));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 0);
  assert.equal(res.filter((r) => r.reason.code === 'invalid_credentials').length, MAX_PIN_FAILS - 1); // only 5 guesses were ever evaluated
  const [{ locked_until }] = (await pool.query(`select locked_until from accounts where login_key like '%|z9|race me'`)).rows;
  assert.ok(locked_until);
});

test('PIN is stored only as a salted hash', async () => {
  const rows = (await pool.query('select pin_hash, login_key from accounts where pin_hash is not null')).rows;
  assert.ok(rows.length >= 5);
  for (const r of rows) { assert.match(r.pin_hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/); assert.ok(!r.pin_hash.includes('482916')); }
  assert.equal(new Set(rows.map((r) => r.pin_hash.split(':')[0])).size, rows.length); // unique salts
});

test('per-IP cap on sign-up/sign-in attempts', async () => {
  const strict = createPinAuth({ pool, withUser, ipLimiter: createLimiter({ windowMs: 60e3, max: 3 }) });
  for (let i = 0; i < 3; i++) await strict.login(who({ pin: '000000' }), '7.7.7.7').catch(() => {});
  await fails(strict.login(who(), '7.7.7.7'), 'otp_rate_limited', 429);
  await strict.login(who(), '6.6.6.6');
});

test('two sign-ups of the same name at the same instant: exactly one wins and no orphan account', async () => {
  const w = who({ display_name: 'Twin', flat_label: 'Q-1' });
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => pa.signup(w, 'x')));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await pool.query(`select count(*)::int n from accounts where login_key like '%|q1|twin'`)).rows[0].n, 1);
  assert.equal((await pool.query(`select count(*)::int n from profiles where display_name = 'Twin'`)).rows[0].n, 1);
});
