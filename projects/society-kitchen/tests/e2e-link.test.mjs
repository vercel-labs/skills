// End-to-end invite-link + PIN sign-in (the default mode): browser -> server -> Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183, BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_URL = process.env.ADMIN_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_link_e2e';
const SHOTS = process.env.SHOTS ?? path.join(ROOT, 'shots');
let server, browser; const contexts = [], jsErrors = [];

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  execFileSync('bash', [path.join(ROOT, 'scripts/setup.sh')], { env: { ...process.env, DB, ADMIN_URL }, stdio: 'pipe' });
  const env = { ...process.env, PORT: String(PORT), DATABASE_URL: `${ADMIN_URL.replace(/\/[^/]*$/, '')}/${DB}` };
  delete env.AUTH_MODE; // the default must be link mode
  server = spawn('node', [path.join(ROOT, 'server/server.mjs')], { env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  browser = await chromium.launch();
});
after(async () => { for (const c of contexts) await c.close().catch(() => {}); await browser?.close(); server?.kill(); });

async function open(url = '/') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata', permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|Failed to load resource/.test(m.text())) jsErrors.push(m.text()); });
  await page.goto(BASE + url);
  return page;
}
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, `link-${n}.png`) });
const see = (page, t) => page.getByText(t).first().waitFor({ timeout: 6000 });
async function signinTab(page) { // the form re-renders after the click; wait for it before typing
  await page.getByRole('tab', { name: 'I have an account' }).click();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
}
async function fill(page, { invite, name, flat, pin }) {
  if (invite !== undefined) await page.locator('#invite').fill(invite);
  await page.locator('#name').fill(name); await page.locator('#flat').fill(flat); await page.locator('#pin').fill(pin);
  await page.locator('#go').click();
  // let the request finish (the form re-enables on an error, or goes away on success)
  await page.waitForFunction(() => { const b = document.querySelector('#go'); return !b || !b.disabled; });
}

test('the invite link prefills the code and is tidied out of the address bar', async () => {
  const page = await open('/?join=MAPLE-123');
  await see(page, 'Society invite code');
  assert.equal(await page.locator('#invite').inputValue(), 'MAPLE-123');
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await page.getByText('Maple Residency').count(), 0); // no resident list leaks
  await shot(page, '1-signup');
});

test('a neighbour signs up with the link, lands in the app, stays signed in on reload', async () => {
  const page = await open('/?join=maple-123');
  await fill(page, { name: 'Test Neighbour', flat: 'E-707', pin: '135790' });
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  assert.equal(await page.getByText('Lakeview poha').count(), 0);
  await page.reload();
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  const c = (await page.context().cookies()).find((x) => x.name === 'sk_session');
  assert.ok(c.httpOnly && c.sameSite === 'Lax');
  await page.goto(`${BASE}/#/account`);
  await see(page, 'Test Neighbour'); await see(page, 'Code MAPLE-123');
  await shot(page, '2-account');
  await page.getByRole('button', { name: 'Share invite link' }).click();
  await see(page, 'Invite copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, new RegExp(`${BASE.replace(/[.]/g, '\\.')}/\\?join=MAPLE-123`)); assert.match(clip, /Maple Residency/);
});

test('wrong invite code and bad PIN are refused with clear messages', async () => {
  const page = await open('/');
  await fill(page, { invite: 'WRONG-1', name: 'Someone', flat: 'A-1', pin: '123456' });
  await see(page, "invite code isn't right");
  await fill(page, { invite: 'MAPLE-123', name: 'Someone', flat: 'A-1', pin: '12' });
  await see(page, 'exactly 6 digits');
  await shot(page, '3-errors');
});

test('same name and flat cannot sign up twice', async () => {
  const page = await open('/?join=MAPLE-123');
  await fill(page, { name: 'test neighbour', flat: 'e707', pin: '222222' });
  await see(page, 'already registered');
});

test('sign back in on a new phone: wrong PIN counts down, right PIN works; log out ends the session', async () => {
  const page = await open('/?join=MAPLE-123');
  await signinTab(page);
  await fill(page, { name: 'Test Neighbour', flat: 'E-707', pin: '000000' });
  await see(page, '4 tries left');
  await shot(page, '4-wrong-pin');
  await fill(page, { name: 'Test Neighbour', flat: 'E-707', pin: '135790' });
  await page.getByText('Creamy pasta Alfredo').first().waitFor();
  const token = (await page.context().cookies()).find((x) => x.name === 'sk_session').value;
  await page.goto(`${BASE}/#/account`);
  await page.getByRole('button', { name: 'Log out' }).click();
  await see(page, 'Society invite code');
  assert.equal((await fetch(`${BASE}/api/me`, { headers: { cookie: `sk_session=${token}` } })).status, 401);
});

test('five wrong PINs lock the account (even the right PIN is refused)', async () => {
  const page = await open('/?join=MAPLE-123');
  await signinTab(page);
  for (let i = 0; i < 5; i++) await fill(page, { name: 'Test Neighbour', flat: 'E-707', pin: '999999' });
  await see(page, 'Try again in 15 minutes').catch(async (e) => { throw new Error('screen said: ' + await page.locator('#err').textContent()); });
  await fill(page, { name: 'Test Neighbour', flat: 'E-707', pin: '135790' });
  await see(page, 'Try again in 15 minutes');
  await shot(page, '5-locked');
});

test('a signed-in neighbour can book, and the app has no JS errors', async () => {
  const page = await open('/?join=MAPLE-123');
  await fill(page, { name: 'Booker Bee', flat: 'F-808', pin: '314159' });
  await page.getByText('Evening samosas').first().waitFor();
  await page.getByText('Creamy pasta Alfredo').first().click();
  await page.locator('#book').click();
  await see(page, 'Booked');
  assert.deepEqual(jsErrors, []);
});

test('server: default mode is link; dev and otp routes are absent; changes need the x-sk header', async () => {
  assert.equal((await (await fetch(`${BASE}/api/config`)).json()).authMode, 'link');
  assert.equal((await fetch(`${BASE}/api/dev/users`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/auth/request-otp`, { method: 'POST', headers: { 'x-sk': '1' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`${BASE}/api/listings`, { headers: { 'x-user-id': 'a0000000-0000-0000-0000-000000000001' } })).status, 401);
  assert.equal((await fetch(`${BASE}/api/auth/login`, { method: 'POST', body: '{}' })).status, 403);
});
