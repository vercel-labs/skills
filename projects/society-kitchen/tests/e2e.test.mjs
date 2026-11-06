// End-to-end: real browser (Chromium) -> web app -> API -> Postgres.
// Tests run in order and share one freshly seeded database.
//   ADMIN_URL=postgres://user@host:port/postgres SHOTS=./shots npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_URL = process.env.ADMIN_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_e2e';
const SHOTS = process.env.SHOTS ?? path.join(ROOT, 'shots');

const u = (n) => `a0000000-0000-0000-0000-00000000000${n}`;
const U = { meera: u(1), harpreet: u(2), sunita: u(3), farah: u(4), rohan: u(5), anita: u(6), kabir: u(7), vikram: u(8) };
const L = (n) => `b0000000-0000-0000-0000-00000000000${n}`;
const LISTING = { pasta: L(1), paratha: L(2), rajma: L(3), jamun: L(4), samosa: L(5), lake: L(6), biryani: L(7) };

let server, browser;
const contexts = [];
const jsErrors = [];

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  execFileSync('bash', [path.join(ROOT, 'scripts/setup.sh')], { env: { ...process.env, DB, ADMIN_URL }, stdio: 'pipe' });
  const dbUrl = `${ADMIN_URL.replace(/\/[^/]*$/, '')}/${DB}`;
  server = spawn('node', [path.join(ROOT, 'server/server.mjs')], { env: { ...process.env, AUTH_MODE: 'dev', DATABASE_URL: dbUrl, PORT: String(PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});

after(async () => {
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close();
  server?.kill();
});

// ---------- helpers ----------
async function open(who, hash = '#/') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' });
  contexts.push(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (who) await ctx.addInitScript((uid) => { if (!localStorage.getItem('uid')) localStorage.setItem('uid', uid); }, U[who]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|Failed to load resource/.test(m.text())) jsErrors.push(`${who} console: ${m.text()}`); });
  await page.goto(`${BASE}/${hash}`);
  return page;
}
async function api(who, method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', 'x-sk': '1', 'x-user-id': U[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const see = (page, text, opts = {}) => page.getByText(text, opts).first().waitFor({ timeout: 6000 });
const gone = async (page, text) => assert.equal(await page.getByText(text).count(), 0, `"${text}" should not be on the page`);
const avail = async (who, id) => (await api(who, 'GET', `/api/listings/${id}`)).body.listing.available_quantity;
const toastText = async (page) => { await page.locator('#toast.show').waitFor(); return page.locator('#toast').textContent(); };

// ---------- tests ----------
test('sign-in screen lists residents grouped by society', async () => {
  const page = await open(null, '#/');
  await see(page, 'Society Kitchen');
  await see(page, 'Harmony Residency'); await see(page, 'Lakeview Heights');
  await shot(page, '00-login');
  await page.getByRole('button', { name: /Anita Desai/ }).click();
  await see(page, "What's cooking");
});

test('browse: a resident sees only their own society, with accurate availability', async () => {
  const page = await open('rohan');
  await see(page, "What's cooking");
  await page.locator('a.card.link').first().waitFor();
  assert.equal(await page.locator('a.card.link').count(), 5);
  await see(page, '4 of 6 left'); await see(page, 'Sold out'); await see(page, 'Only 2 left'); await see(page, '8 of 10 left');
  await gone(page, 'Lakeview poha');
  await shot(page, '01-browse');
  await page.getByRole('button', { name: 'Available only' }).click();
  await gone(page, 'Aloo paratha with curd'); await see(page, 'Creamy pasta Alfredo');
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await see(page, 'Creamy pasta Alfredo');
});

test('booking: stepper, price, instant confirmation, availability drops', async () => {
  const page = await open('rohan');
  await page.getByText('Creamy pasta Alfredo').first().click();
  await see(page, 'Free until');
  await page.getByRole('button', { name: 'One more portion' }).click();
  await page.getByRole('button', { name: 'One more portion' }).click();
  await see(page, 'Book 3 portions · ₹450');
  await shot(page, '02-detail');
  await page.getByRole('button', { name: /Book 3 portions/ }).click();
  await see(page, "You're booked");
  await see(page, 'Pay ₹450 to Meera');
  await shot(page, '03-confirmed');
  assert.equal(await avail('rohan', LISTING.pasta), 1);
  await page.getByRole('link', { name: 'View my bookings' }).click();
  await see(page, '3 portions · ₹450 · Meera Iyer');
});

test('race: the last portion is taken while another buyer is looking -> clear conflict, nothing booked', async () => {
  const kabir = await open('kabir', `#/listing/${LISTING.pasta}`);
  await see(kabir, 'Book 1 portion · ₹150');
  assert.equal(await kabir.getByRole('button', { name: 'One more portion' }).isDisabled(), true);
  assert.equal((await api('anita', 'POST', `/api/listings/${LISTING.pasta}/book`, { quantity: 1 })).status, 200);
  await kabir.getByRole('button', { name: /Book 1 portion/ }).click();
  await see(kabir, 'Someone booked just before you');
  await see(kabir, 'this offer just sold out');
  await shot(kabir, '04-conflict-soldout');
  assert.equal(await kabir.getByRole('button', { name: /^Book/ }).count(), 0);
  assert.equal(await avail('kabir', LISTING.pasta), 0);
});

test('race: partly available -> told the current count and can book what is left', async () => {
  const kabir = await open('kabir', `#/listing/${LISTING.rajma}`);
  await kabir.getByRole('button', { name: 'One more portion' }).click();
  await see(kabir, 'Book 2 portions · ₹240');
  await api('anita', 'POST', `/api/listings/${LISTING.rajma}/book`, { quantity: 1 });
  await kabir.getByRole('button', { name: /Book 2 portions/ }).click();
  await see(kabir, 'only 1 is left now');
  await shot(kabir, '05-conflict-partial');
  await kabir.getByRole('button', { name: 'Book 1 portion · ₹120' }).click();
  await see(kabir, "You're booked");
  assert.equal(await avail('kabir', LISTING.rajma), 0);
});

test('cancel: allowed before the cutoff (portion returns), blocked inside the final hour', async () => {
  const page = await open('rohan', '#/bookings');
  await see(page, 'My bookings');
  await page.locator('[data-booking]').first().waitFor();
  const samosa = page.locator('[data-booking]').filter({ hasText: 'Evening samosas' });
  await see(page, 'Cancellation closed at');
  assert.equal(await samosa.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
  assert.equal(await samosa.getByRole('button', { name: 'Cancel booking' }).count(), 0);
  await shot(page, '06-bookings');

  // The server enforces it too, not just the button.
  const mine = (await api('rohan', 'GET', '/api/bookings')).body.bookings;
  const blocked = await api('rohan', 'POST', `/api/bookings/${mine.find((b) => b.title === 'Evening samosas').id}/cancel`);
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error, 'cancellation_closed');

  const before = await avail('rohan', LISTING.rajma);
  const rajma = page.locator('[data-booking]').filter({ hasText: 'Rajma chawal bowl' });
  await rajma.getByRole('button', { name: 'Cancel booking' }).click();
  await see(page, 'Cancel this booking?');
  await shot(page, '07-cancel-sheet');
  await page.getByRole('button', { name: 'Yes, cancel booking' }).click();
  assert.match(await toastText(page), /Booking cancelled/);
  assert.equal(await avail('rohan', LISTING.rajma), before + 1);
  await page.getByRole('button', { name: /^Past/ }).click();
  await see(page, 'You cancelled this booking.');
});

test('seller: describe an offer in plain language, review flags what is unclear, publish', async () => {
  const page = await open('meera', '#/sell/new');
  await see(page, "Tell us what you're making");
  await page.locator('#offer').fill('Lemon rice for 4 people, pickup at the Tower B lobby at 7 PM tomorrow, ₹80 per portion');
  await shot(page, '08-describe');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await see(page, 'Review your listing');
  await see(page, 'Lemon rice'); await see(page, 'Tower B lobby'); await see(page, '₹80');
  await see(page, 'Needed'); await see(page, 'Please confirm');
  await see(page, 'Should buyers book 4 portions');
  assert.equal(await page.locator('#publish').isDisabled(), true);
  assert.match(await page.locator('.footer .note').textContent(), /description/);
  await shot(page, '09-review');
  await page.locator('#ed-description').fill('Tangy lemon rice with peanuts and curry leaves. Vegetarian.');
  await page.locator('[data-action=save][data-key=description]').click();
  await see(page, 'Tangy lemon rice');
  assert.equal(await page.locator('#publish').isDisabled(), true, 'still needs the portions confirmation');
  await page.getByRole('button', { name: 'Yes, 4 portions' }).click();
  await page.locator('#publish:not([disabled])').waitFor();
  await page.locator('#publish').click();
  assert.match(await toastText(page), /live/);
  await see(page, 'My listings'); await see(page, 'Lemon rice');
  await shot(page, '10-dashboard');
  const rohan = await open('rohan');
  await see(rohan, 'Lemon rice');
});

test('seller: cannot drop quantity below what is booked; can adjust; closing cancels bookings and tells buyers', async () => {
  const lemon = (await api('rohan', 'GET', '/api/listings')).body.listings.find((l) => l.title === 'Lemon rice');
  assert.equal((await api('rohan', 'POST', `/api/listings/${lemon.id}/book`, { quantity: 2 })).status, 200);
  const page = await open('meera', `#/sell/manage/${lemon.id}`);
  await see(page, 'Rohan Mehta · C-807');
  const minus = page.getByRole('button', { name: 'One fewer portion' });
  await minus.click(); await minus.click();                 // 4 -> 3 -> 2 (still allowed)
  assert.equal(await page.locator('#save').isDisabled(), false);
  await minus.click();                                       // 1: below the 2 booked
  await see(page, "You can't go below 2. 2 portions already booked.");
  assert.equal(await page.locator('#save').isDisabled(), true);
  await shot(page, '11-manage-error');
  await page.getByRole('button', { name: 'One more portion' }).click();
  await page.getByRole('button', { name: 'One more portion' }).click();   // 3
  await page.locator('#save').click();
  assert.match(await toastText(page), /Saved/);
  assert.equal((await api('meera', 'GET', `/api/my-listings/${lemon.id}`)).body.listing.total_quantity, 3);

  await page.getByRole('button', { name: 'Close listing' }).click();
  await see(page, '1 booking (2 portions) will be cancelled');
  await shot(page, '12-close-sheet');
  await page.getByRole('button', { name: 'Yes, close listing' }).click();
  await see(page, 'My listings');
  const rohanAlerts = await open('rohan', '#/alerts');
  await see(rohanAlerts, 'Offer cancelled by seller');
  assert.equal((await api('rohan', 'POST', `/api/listings/${lemon.id}/book`, { quantity: 1 })).body.error, 'listing_closed');
});

test('alerts: seller sees bookings and sold-out; unread badge clears once read', async () => {
  const page = await open('meera');
  await page.locator('#nav .badge').waitFor();
  await page.getByRole('link', { name: /Alerts/ }).click();
  await see(page, 'New booking');
  await see(page, 'Creamy pasta Alfredo is fully booked');
  await see(page, 'All 6 portions are taken');
  await shot(page, '13-alerts');
  await page.waitForTimeout(600);
  await page.reload();
  await see(page, 'Alerts');
  assert.equal(await page.locator('#nav .badge').count(), 0);
});

test('seller: own listing offers management instead of booking; half-finished draft cannot be published', async () => {
  const page = await open('meera', `#/listing/${LISTING.pasta}`);
  await see(page, 'Manage your listing');
  assert.equal(await page.getByRole('button', { name: /^Book/ }).count(), 0);
  await page.goto(`${BASE}/#/sell`);
  await see(page, 'Veg biryani'); await see(page, 'Draft');
  await page.getByRole('link', { name: 'Continue' }).click();
  await see(page, 'Review your listing');
  assert.equal(await page.locator('#publish').isDisabled(), true);
  assert.equal(await page.getByText('Needed').count() >= 4, true);
});

test('seller: the form route works too', async () => {
  const page = await open('farah', '#/sell/new');
  await page.getByRole('button', { name: 'Use a form' }).click();
  await shot(page, '14-form');
  await page.locator('#f-title').fill('Masala chai flask');
  await page.locator('#f-desc').fill('Fresh masala chai, serves 2 per flask. Contains milk.');
  await page.locator('#f-qty').fill('5');
  await page.locator('#f-price').fill('90');
  await page.locator('#f-where').fill('Clubhouse');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await see(page, 'Review your listing');
  await page.locator('#publish:not([disabled])').waitFor();
  await page.locator('#publish').click();
  await see(page, 'Masala chai flask');
});

test('privacy: residents of another society cannot see or book Harmony listings', async () => {
  const page = await open('vikram');
  await see(page, 'Lakeview poha');
  assert.equal(await page.locator('a.card.link').count(), 1);
  assert.equal((await api('vikram', 'GET', `/api/listings/${LISTING.pasta}`)).status, 404);
  assert.equal((await api('vikram', 'POST', `/api/listings/${LISTING.jamun}/book`, { quantity: 1 })).status, 404);
  assert.equal((await api('vikram', 'GET', '/api/bookings')).body.bookings.length, 0);
});

test('API rejects missing sign-in and tampering', async () => {
  assert.equal((await fetch(`${BASE}/api/listings`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/listings`, { headers: { 'x-user-id': "x'; drop table listings;--" } })).status, 401);
  const r = await api('rohan', 'PATCH', `/api/listings/${LISTING.pasta}`, { total_quantity: 99 });
  assert.equal(r.status, 404, "a buyer can't edit someone else's listing");
  const r2 = await api('meera', 'PATCH', `/api/listings/${LISTING.pasta}`, { booked_quantity: 0 });
  assert.equal(r2.body.error, 'unknown_fields');
});

test('no JavaScript errors occurred in any page during the run', () => {
  assert.deepEqual(jsErrors, []);
});
