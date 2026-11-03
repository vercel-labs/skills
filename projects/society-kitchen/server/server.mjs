// Society Kitchen server: serves the web app and a small JSON API.
// Zero dependencies. Every rule (capacity, cutoff, quantity floor, ...) lives in
// the database functions; this layer only authenticates, calls them, and shapes
// the results. Reads run as the `authenticated` role so row-level security applies.
//
//   DATABASE_URL=postgres://... AUTH_SECRET=<long random> OTP_PROVIDER=webhook \
//     OTP_WEBHOOK_URL=https://... COOKIE_SECURE=1 node server/server.mjs
//
// AUTH_MODE=otp (default): phone number + one-time code, cookie session.
// AUTH_MODE=dev: "pick any seeded user" with no password. DEVELOPMENT ONLY;
//                never expose a dev-mode server to the internet.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '../lib/minipg.mjs';
import { extractListing } from './extract.mjs';
import { createAuth, AuthError } from './auth.mjs';
import { createSender } from './sms.mjs';
import { createLimiter } from './ratelimit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(here, '../app');
const PORT = Number(process.env.PORT ?? 4173);
const AUTH_MODE = process.env.AUTH_MODE ?? 'otp';
const COOKIE = 'sk_session';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (!['otp', 'dev'].includes(AUTH_MODE)) { console.error('AUTH_MODE must be otp or dev'); process.exit(1); }
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required, e.g. postgres://user@127.0.0.1:5432/society_kitchen');
  process.exit(1);
}
let authSecret = process.env.AUTH_SECRET;
const otpProvider = process.env.OTP_PROVIDER ?? 'console';
if (AUTH_MODE === 'otp') {
  if (!authSecret || authSecret.length < 16) { console.error('AUTH_SECRET (16+ random characters) is required in otp mode'); process.exit(1); }
  if (otpProvider === 'console' && process.env.ALLOW_CONSOLE_OTP !== '1') {
    console.error('OTP_PROVIDER=console prints codes in the log. Set OTP_PROVIDER=webhook, or ALLOW_CONSOLE_OTP=1 for local testing.');
    process.exit(1);
  }
} else if (!authSecret) {
  authSecret = crypto.randomBytes(24).toString('hex');
  console.warn('WARNING: AUTH_MODE=dev - anyone can sign in as any seeded user. Do not expose this server.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const auth = createAuth({
  pool, secret: authSecret,
  send: createSender({ provider: otpProvider, webhookUrl: process.env.OTP_WEBHOOK_URL }),
});
const joinLimiter = createLimiter({ windowMs: 3600e3, max: 10 });

class ApiError extends Error {
  constructor(status, code, detail = {}) { super(code); this.status = status; this.code = code; this.detail = detail; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Run `fn(client)` in a transaction as the signed-in user, under RLS.
async function withUser(uid, fn) {
  if (!uid || !UUID.test(uid)) throw new ApiError(401, 'not_authenticated');
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);
    await c.query('set local role authenticated');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    try { await c.query('rollback'); } catch {}
    throw e;
  } finally {
    c.release();
  }
}
const rows = async (c, sql, params) => (await c.query(sql, params)).rows;

// Database errors -> API errors. Our functions raise P0001 with a stable code.
function mapDbError(e) {
  if (e instanceof ApiError || e instanceof AuthError) return e;
  if (e.code === 'P0001') {
    let detail = {};
    try { detail = JSON.parse(e.detail || '{}'); } catch {}
    const status = /_not_found$/.test(e.message) ? 404 : /^(not_authenticated|profile_required)$/.test(e.message) ? 401 : 409;
    return new ApiError(status, e.message, detail);
  }
  if (/^2[23]/.test(e.code || '')) return new ApiError(400, 'invalid_value', { message: e.message });
  return null;
}

const LISTING = `
  select l.id, l.title, l.description, l.total_quantity, l.booked_quantity, l.available_quantity,
         l.quantity_unit, l.price_paise, l.currency, l.pickup_at, l.pickup_location,
         l.status, l.display_status, l.seller_id, l.created_at,
         (l.pickup_at - interval '1 hour') as cancel_cutoff,
         p.display_name as seller_name, p.flat_label as seller_flat,
         (l.seller_id = app_uid()) as is_mine
    from listings_with_availability l join profiles p on p.id = l.seller_id`;

const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) =>
  routes.push({ method, auth, handler, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

route('GET', '/api/health', async () => ({ ok: true }), { auth: false });

route('GET', '/api/config', async () => ({ authMode: AUTH_MODE }), { auth: false });

// ---- sign-in ----
const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;

if (AUTH_MODE === 'otp') {
  route('POST', '/api/auth/request-otp', ({ body, ip }) => auth.requestOtp(body.phone, ip), { auth: false });
  route('POST', '/api/auth/verify-otp', async ({ body, req }) => {
    const { token, accountId } = await auth.verifyOtp(body.phone, body.code, req.headers['user-agent']);
    const [p] = await pool.query('select 1 from profiles where id = $1', [accountId]).then((r) => r.rows);
    return { ok: true, has_profile: !!p, _cookie: cookieHeader(token, 30 * 86400) };
  }, { auth: false });
} else {
  // Dev only: list seeded users (runs without RLS).
  route('GET', '/api/dev/users', async () => ({
    users: (await pool.query(
      `select p.id, p.display_name, p.flat_label, s.name as society
         from profiles p join societies s on s.id = p.society_id order by s.name, p.display_name`)).rows,
  }), { auth: false });
}

route('POST', '/api/auth/logout', async ({ token }) => {
  await auth.revoke(token);
  return { ok: true, _cookie: cookieHeader('', 0) };
}, { auth: false });

route('POST', '/api/auth/join', async ({ uid, body }) => {
  const lim = joinLimiter.hit(uid);
  if (!lim.ok) throw new ApiError(429, 'otp_rate_limited', { retry_after: Math.ceil(lim.retryAfterMs / 1000) });
  return withUser(uid, async (c) => {
    const [row] = await rows(c, 'select * from join_society($1, $2, $3)', [body.invite_code, body.display_name, body.flat_label]);
    return { ok: true, profile: row ?? null };
  });
});

route('GET', '/api/me', ({ uid }) => withUser(uid, async (c) => {
  const [acct] = (await pool.query('select id, phone from accounts where id = $1', [uid])).rows;
  const account = { id: uid, phone: acct?.phone ?? null };
  const [me] = await rows(c, `select p.id, p.display_name, p.flat_label, s.name as society_name
                                from profiles p join societies s on s.id = p.society_id where p.id = app_uid()`);
  if (!me) return { account, me: null, unread: 0 };
  const [{ n }] = await rows(c, `select count(*)::int as n from notifications where read_at is null`);
  return { account, me, unread: n };
}));

// ---- buyer ----
route('GET', '/api/listings', ({ uid }) => withUser(uid, async (c) => ({
  listings: await rows(c, `${LISTING} where l.status = 'published' and l.display_status in ('available', 'sold_out')
                           order by l.pickup_at, l.created_at`),
})));

route('GET', '/api/listings/:id', ({ uid, params }) => withUser(uid, async (c) => {
  const [listing] = await rows(c, `${LISTING} where l.id = $1`, [params.id]);
  if (!listing) throw new ApiError(404, 'listing_not_found');
  return { listing };
}));

route('POST', '/api/listings/:id/book', ({ uid, params, body }) => withUser(uid, async (c) => {
  const [{ r }] = await rows(c, 'select book_listing($1, $2) as r', [params.id, body.quantity]);
  return r;
}));

route('GET', '/api/bookings', ({ uid }) => withUser(uid, async (c) => ({
  bookings: await rows(c, `
    select b.id, b.quantity, b.status, b.cancel_reason, b.created_at, b.cancelled_at,
           l.id as listing_id, l.title, l.price_paise, l.pickup_at, l.pickup_location, l.quantity_unit,
           p.display_name as seller_name, p.flat_label as seller_flat,
           (l.pickup_at - interval '1 hour') as cancel_cutoff,
           (b.status = 'confirmed' and now() < l.pickup_at - interval '1 hour') as can_cancel,
           (l.pickup_at <= now()) as is_past
      from bookings b join listings l on l.id = b.listing_id join profiles p on p.id = l.seller_id
     where b.buyer_id = app_uid()
     order by l.pickup_at`),
})));

route('POST', '/api/bookings/:id/cancel', ({ uid, params }) => withUser(uid, async (c) => {
  const [{ r }] = await rows(c, 'select cancel_booking($1) as r', [params.id]);
  return r;
}));

// ---- seller ----
route('GET', '/api/my-listings', ({ uid }) => withUser(uid, async (c) => ({
  listings: await rows(c, `${LISTING} where l.seller_id = app_uid() order by l.created_at desc`),
})));

route('GET', '/api/my-listings/:id', ({ uid, params }) => withUser(uid, async (c) => {
  const [listing] = await rows(c, `${LISTING} where l.id = $1 and l.seller_id = app_uid()`, [params.id]);
  if (!listing) throw new ApiError(404, 'listing_not_found');
  const bookings = await rows(c, `
    select b.id, b.quantity, b.status, b.cancel_reason, b.created_at, b.cancelled_at,
           p.display_name as buyer_name, p.flat_label as buyer_flat
      from bookings b join profiles p on p.id = b.buyer_id
     where b.listing_id = $1 order by b.created_at desc`, [params.id]);
  return { listing, bookings };
}));

route('POST', '/api/drafts', ({ uid, body }) => withUser(uid, async (c) => {
  const [row] = await rows(c, 'select * from create_listing_draft($1::jsonb)', [JSON.stringify(body.fields ?? {})]);
  return { id: row.id };
}));

route('POST', '/api/drafts/extract', ({ uid, body }) => withUser(uid, async (c) => {
  const text = String(body.text ?? '').trim();
  if (text.length < 3) throw new ApiError(400, 'text_required');
  const ex = extractListing(text);
  const [row] = await rows(c, 'select * from create_listing_draft($1::jsonb)', [JSON.stringify(ex.fields)]);
  return { id: row.id, notes: { confirm: ex.confirm, needs: ex.needs } };
}));

route('DELETE', '/api/drafts/:id', ({ uid, params }) => withUser(uid, async (c) => {
  await c.query('select discard_draft($1)', [params.id]);
  return { ok: true };
}));

route('PATCH', '/api/listings/:id', ({ uid, params, body }) => withUser(uid, async (c) => {
  await c.query('select update_listing($1, $2::jsonb)', [params.id, JSON.stringify(body)]);
  return { ok: true };
}));

route('POST', '/api/listings/:id/publish', ({ uid, params }) => withUser(uid, async (c) => {
  await c.query('select publish_listing($1)', [params.id]);
  return { ok: true };
}));

route('POST', '/api/listings/:id/close', ({ uid, params }) => withUser(uid, async (c) => {
  const [{ r }] = await rows(c, 'select close_listing($1) as r', [params.id]);
  return { cancelled_bookings: r.cancelled_bookings };
}));

// ---- notifications ----
route('GET', '/api/notifications', ({ uid }) => withUser(uid, async (c) => ({
  notifications: await rows(c, `select id, type, listing_id, booking_id, title, body, created_at, read_at
                                  from notifications order by created_at desc limit 50`),
})));

route('POST', '/api/notifications/read', ({ uid }) => withUser(uid, async (c) => {
  await c.query('update notifications set read_at = now() where user_id = app_uid() and read_at is null');
  return { ok: true };
}));

// ---- http plumbing ----
function send(res, status, data) {
  const { _cookie, ...rest } = data ?? {};
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (_cookie !== undefined) headers['set-cookie'] = _cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(rest));
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function clientIp(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim() || req.socket.remoteAddress;
  return req.socket.remoteAddress;
}

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const ch of req) { size += ch.length; if (size > 100_000) throw new ApiError(413, 'too_large'); chunks.push(ch); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'bad_json'); }
}

async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) return send(res, 404, { error: 'not_found' });
  try {
    // CSRF: browsers cannot add a custom header cross-site without a CORS preflight,
    // which this server never approves.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-sk'] !== '1') throw new ApiError(403, 'csrf');
    const params = url.pathname.match(r.re).groups ?? {};
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : {};
    const token = readCookie(req, COOKIE);
    let uid = '';
    if (r.auth || token) uid = (await auth.sessionAccount(token)) ?? '';
    if (!uid && AUTH_MODE === 'dev') uid = String(req.headers['x-user-id'] ?? '');
    if (r.auth && !UUID.test(uid)) throw new ApiError(401, 'not_authenticated');
    send(res, 200, await r.handler({ uid, params, body, url, req, token, ip: clientIp(req) }));
  } catch (e) {
    const err = mapDbError(e);
    if (err) return send(res, err.status, { error: err.code, detail: err.detail });
    console.error('API error:', e);
    send(res, 500, { error: 'server_error' });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(APP_DIR, rel));
  if (!file.startsWith(APP_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e); if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
}).listen(PORT, () => console.log(`Society Kitchen on http://localhost:${PORT}  (AUTH_MODE=${AUTH_MODE})`));
