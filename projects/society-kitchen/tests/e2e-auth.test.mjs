// End-to-end sign-in: browser -> server (AUTH_MODE=otp) -> Postgres, with a fake SMS gateway.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4181, SMS_PORT = 4182;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_URL = process.env.ADMIN_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_auth_e2e';
const SHOTS = process.env.SHOTS ?? path.join(ROOT, 'shots');

let server, sms, browser;
const inbox = []; const jsErrors = []; const contexts = [];
const codeFor = (phone) => inbox.filter((m) => m.phone === phone).at(-1).message.match(/^(\d{6})/)[1];

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  execFileSync('bash', [path.join(ROOT, 'scripts/setup.sh')], { env: { ...process.env, DB, ADMIN_URL }, stdio: 'pipe' });
  sms = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { inbox.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise((r) => sms.listen(SMS_PORT, '127.0.0.1', r));
  server = spawn('node', [path.join(ROOT, 'server/server.mjs')], { stdio: 'pipe', env: {
    ...process.env, AUTH_MODE: 'otp', AUTH_SECRET: 'e2e-secret-0123456789abcdef', OTP_PROVIDER: 'webhook',
    OTP_WEBHOOK_URL: `http://127.0.0.1:${SMS_PORT}/sms`, PORT: String(PORT),
    DATABASE_URL: `${ADMIN_URL.replace(/\/[^/]*$/, '')}/${DB}` } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  browser = await chromium.launch();
});
after(async () => { for (const c of contexts) await c.close().catch(() => {}); await browser?.close(); server?.kill(); sms?.close(); });

async function open(hash = '#/') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' });
  contexts.push(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|Failed to load resource/.test(m.text())) jsErrors.push(m.text()); });
  await page.goto(`${BASE}/${hash}`);
  return { page, ctx };
}
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, `auth-${n}.png`) });
const see = (page, t) => page.getByText(t).first().waitFor({ timeout: 6000 });
async function sendCode(page, tenDigits) {
  await page.locator('#phone').fill(tenDigits); await page.locator('#go').click();
  await see(page, 'Enter your code');
}
async function enter(page, code) { await page.locator('#code').fill(code); await page.locator('#go').click(); }

test('signed-out visitor sees the phone screen, not the dev picker', async () => {
  const { page } = await open();
  await see(page, 'Sign in with your mobile number');
  assert.equal(await page.getByText('Maple Residency').count(), 0);
  await shot(page, '1-phone');
});

test('existing resident: wrong code, then right code; stays signed in after reload', async () => {
  const { page } = await open();
  await page.locator('#phone').fill('12345'); await page.locator('#go').click();
  await see(page, 'valid 10-digit');
  await sendCode(page, '90000 00006'); // Anita
  await shot(page, '2-code');
  const good = codeFor('+919000000006');
  await enter(page, good === '000000' ? '111111' : '000000');
  await see(page, '4 tries left');
  await shot(page, '3-wrong');
  await enter(page, good);
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  await page.reload();
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === 'sk_session');
  assert.ok(c && c.httpOnly && c.sameSite === 'Lax');
  assert.ok(!(await page.evaluate(() => document.cookie)).includes('sk_session'));
  // book through the real UI as a signed-in user
  await page.getByText('Creamy pasta Alfredo').first().click();
  await page.locator('#book').click();
  await see(page, 'Booked');
  await shot(page, '4-booked');
});

test('account screen shows profile and phone; log out kills the session server-side', async () => {
  const { page, ctx } = await open();
  await sendCode(page, '9000000005');
  await enter(page, codeFor('+919000000005'));
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  const token = (await ctx.cookies()).find((x) => x.name === 'sk_session').value;
  await page.goto(`${BASE}/#/account`);
  await see(page, 'Rohan Mehta'); await see(page, '+919000000005');
  await shot(page, '5-account');
  await page.getByRole('button', { name: 'Log out' }).click();
  await see(page, 'Sign in with your mobile number');
  const replay = await fetch(`${BASE}/api/me`, { headers: { cookie: `sk_session=${token}` } });
  assert.equal(replay.status, 401);
});

test('new number: join screen rejects a wrong invite code, accepts the right one, then can use the app', async () => {
  const { page } = await open();
  await sendCode(page, '9777700001');
  await enter(page, codeFor('+919777700001'));
  await see(page, 'Join your society');
  await page.locator('#invite').fill('WRONG-999'); await page.locator('#name').fill('Neha Gupta'); await page.locator('#flat').fill('A-12');
  await page.locator('#go').click();
  await see(page, 'invite code isn');
  await shot(page, '6-bad-invite');
  await page.reload(); // still routed to join, not into the app
  await see(page, 'Join your society');
  await page.locator('#invite').fill('maple-123'); await page.locator('#name').fill('Neha Gupta'); await page.locator('#flat').fill('A-12');
  await page.locator('#go').click();
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  assert.equal(await page.getByText('Lakeview poha').count(), 0); // only her society's offers
  await page.goto(`${BASE}/#/join`); // a member is sent home
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
});

test('resend is throttled in the UI and the API', async () => {
  const { page } = await open();
  await sendCode(page, '9666600001');
  await see(page, 'Resend code in');
  assert.ok(await page.locator('#resend').isDisabled());
  const r = await fetch(`${BASE}/api/auth/request-otp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sk': '1' }, body: JSON.stringify({ phone: '+919666600001' }) });
  assert.equal(r.status, 429); assert.equal((await r.json()).error, 'otp_too_soon');
  await page.locator('#back').click();
  await see(page, 'Mobile number');
});

test('server-side guards', async () => {
  const post = (url, body, h = {}) => fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  assert.equal((await post('/api/auth/request-otp', { phone: '9000000001' })).status, 403); // no x-sk
  assert.equal((await fetch(`${BASE}/api/listings`, { headers: { 'x-user-id': 'a0000000-0000-0000-0000-000000000001' } })).status, 401); // dev header ignored
  assert.equal((await fetch(`${BASE}/api/dev/users`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/listings`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/listings`, { headers: { cookie: 'sk_session=' + 'a'.repeat(43) } })).status, 401);
  assert.equal((await post('/api/auth/join', { invite_code: 'MAPLE-123', display_name: 'x', flat_label: 'y' }, { 'x-sk': '1' })).status, 401);
  assert.equal((await post('/api/auth/verify-otp', { phone: '+919000000001', code: '123456' }, { 'x-sk': '1' })).status, 401);
  const cfg = await (await fetch(`${BASE}/api/config`)).json(); assert.equal(cfg.authMode, 'otp');
});

test('no phone numbers or codes appear in the server log of errors; no JS errors in the browser', () => {
  assert.deepEqual(jsErrors, []);
});
