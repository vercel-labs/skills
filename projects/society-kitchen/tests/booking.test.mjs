// Runs the PRD acceptance criteria against a real Postgres.
// Needs a superuser connection: DATABASE_URL=postgres://user@host:port/postgres
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../lib/minipg.mjs'; // zero-dependency client; the real `pg` package works too

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DATABASE_URL ?? 'postgres://pgtest@127.0.0.1:54329/postgres';
const DB = 'sk_test';
const dbUrl = (() => { const u = new URL(BASE); u.pathname = `/${DB}`; return u.toString(); })();

let pool, S1, S2, seller, outsider, buyers = [];

// ---------- helpers ----------
const asUser = (c, uid) =>
  c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

// One call as a user, in its own transaction.
const call = (uid, sql, params = []) =>
  tx(async (c) => { await asUser(c, uid); return (await c.query(sql, params)).rows; });
const book = async (uid, listingId, qty) =>
  (await call(uid, 'select book_listing($1, $2) as r', [listingId, qty]))[0].r;
const cancel = async (uid, bookingId) =>
  (await call(uid, 'select cancel_booking($1) as r', [bookingId]))[0].r;
const edit = async (uid, listingId, changes) =>
  (await call(uid, 'select * from update_listing($1, $2::jsonb)', [listingId, JSON.stringify(changes)]))[0];
const view = async (id) =>
  (await pool.query('select * from listings_with_availability where id = $1', [id])).rows[0];

async function expectErr(promise, code, check) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.message, code, `expected ${code}, got ${e.message}`);
    if (check) check(JSON.parse(e.detail));
    return true;
  });
}

async function mkUser(society, name, flat) {
  const id = crypto.randomUUID();
  await pool.query(
    'insert into profiles (id, society_id, display_name, flat_label) values ($1, $2, $3, $4)',
    [id, society, name, flat]);
  return id;
}

// Fixture listing; `pickup` is a Postgres interval relative to now().
async function mkListing(q, { total = 6, pickup = '3 hours', status = 'published', who = seller } = {}) {
  const { rows } = await q(
    `insert into listings (society_id, seller_id, title, description, total_quantity, price_paise,
                           pickup_at, pickup_location, status, published_at)
     values ($1, $2, 'Creamy pasta', 'Penne in white sauce', $3, 15000,
             now() + $4::interval, 'Clubhouse', $5, case when $5 = 'published' then now() end)
     returning *`,
    [S1, who, total, pickup, status]);
  return rows[0];
}
const mk = (opts) => mkListing(pool.query.bind(pool), opts);

// ---------- setup ----------
before(async () => {
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: dbUrl, max: 30 });
  const sqlFiles = [path.join(here, '../supabase/dev_roles.sql'),
    ...fs.readdirSync(path.join(here, '../supabase/migrations')).sort()
      .map((f) => path.join(here, '../supabase/migrations', f))];
  for (const f of sqlFiles) {
    await pool.query(fs.readFileSync(f, 'utf8'));
  }

  S1 = (await pool.query(`insert into societies (name, invite_code) values ('Harmony Residency', 'HARMONY-123') returning id`)).rows[0].id;
  S2 = (await pool.query(`insert into societies (name, invite_code) values ('Other Society', 'OTHER-999') returning id`)).rows[0].id;
  seller = await mkUser(S1, 'Meera Iyer', 'B-402');
  outsider = await mkUser(S2, 'Outsider', 'Z-1');
  for (let i = 0; i < 20; i++) buyers.push(await mkUser(S1, `Buyer ${i}`, `A-${100 + i}`));
});

after(async () => {
  // Global invariant: stored count always equals the sum of confirmed bookings.
  const { rows } = await pool.query(`
    select l.id, l.booked_quantity, coalesce(sum(b.quantity) filter (where b.status = 'confirmed'), 0)::int as real
      from listings l left join bookings b on b.listing_id = l.id
     group by l.id having l.booked_quantity <> coalesce(sum(b.quantity) filter (where b.status = 'confirmed'), 0)`);
  await pool.end();
  assert.deepEqual(rows, [], 'booked_quantity drifted from confirmed bookings');
});

// ---------- publishing ----------
test('seller can create a draft and publish it once complete', async () => {
  const [draft] = await call(seller, 'select * from create_listing_draft($1::jsonb)', [JSON.stringify({
    title: 'Home-cooked pasta', description: 'Penne, white sauce', total_quantity: 6,
    price_paise: 15000, pickup_location: 'Clubhouse',
    pickup_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
  })]);
  assert.equal(draft.status, 'draft');
  const [pub] = await call(seller, 'select * from publish_listing($1)', [draft.id]);
  assert.equal(pub.status, 'published');
  assert.equal(pub.total_quantity, 6);
  assert.equal(pub.price_paise, 15000);
});

test('publishing a draft with missing fields lists them instead of guessing', async () => {
  const [draft] = await call(seller, 'select * from create_listing_draft($1::jsonb)', [JSON.stringify({ title: 'Mystery dish' })]);
  await expectErr(call(seller, 'select publish_listing($1)', [draft.id]), 'missing_fields',
    (d) => assert.deepEqual(d.fields, ['description', 'total_quantity', 'price_paise', 'pickup_at', 'pickup_location']));
  assert.equal((await view(draft.id)).status, 'draft');
});

test('drafts are invisible to buyers', async () => {
  const l = await mk({ status: 'draft' });
  await expectErr(book(buyers[0], l.id, 1), 'listing_not_found');
});

// ---------- booking ----------
test('booking the last portions confirms and sells the listing out', async () => {
  const l = await mk({ total: 2 });
  const r = await book(buyers[0], l.id, 2);
  assert.equal(r.booking.status, 'confirmed');
  assert.equal(r.sold_out, true);
  assert.equal((await view(l.id)).display_status, 'sold_out');
  const n = await pool.query(`select type from notifications where listing_id = $1 and user_id = $2 order by type`, [l.id, seller]);
  assert.deepEqual(n.rows.map((x) => x.type), ['booking_received', 'listing_sold_out']);
  await expectErr(book(buyers[1], l.id, 1), 'sold_out');
});

test('requesting more than is left fails and reports current availability', async () => {
  const l = await mk({ total: 3 });
  await book(buyers[0], l.id, 2);
  await expectErr(book(buyers[1], l.id, 2), 'insufficient_capacity',
    (d) => { assert.equal(d.available, 1); assert.equal(d.requested, 2); });
  assert.equal((await view(l.id)).available_quantity, 1);
});

test('rejects non-positive quantities and own-listing bookings', async () => {
  const l = await mk();
  await expectErr(book(buyers[0], l.id, 0), 'invalid_quantity');
  await expectErr(book(buyers[0], l.id, -2), 'invalid_quantity');
  await expectErr(book(seller, l.id, 1), 'cannot_book_own_listing');
});

test('residents of another society cannot see or book a listing', async () => {
  const l = await mk();
  await expectErr(book(outsider, l.id, 1), 'listing_not_found');
});

test('a listing whose pickup time has passed cannot be booked and shows as expired', async () => {
  const l = await mk({ pickup: '-1 minute' });
  await expectErr(book(buyers[0], l.id, 1), 'listing_expired');
  assert.equal((await view(l.id)).display_status, 'expired');
});

// ---------- concurrency (separate connections, real lock contention) ----------
test('concurrent buyers each wanting the last 2 portions: exactly one wins', async () => {
  const l = await mk({ total: 2 });
  const results = await Promise.allSettled(buyers.slice(0, 8).map((u) => book(u, l.id, 2)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 7);
  for (const f of failed) assert.ok(['sold_out', 'insufficient_capacity'].includes(f.reason.message), f.reason.message);
  assert.equal((await view(l.id)).booked_quantity, 2);
});

test('20 buyers race for 5 single portions: exactly 5 succeed, never oversold', async () => {
  const l = await mk({ total: 5 });
  const results = await Promise.allSettled(buyers.map((u) => book(u, l.id, 1)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  for (const f of results.filter((r) => r.status === 'rejected')) assert.equal(f.reason.message, 'sold_out');
  const v = await view(l.id);
  assert.equal(v.booked_quantity, 5);
  assert.equal(v.available_quantity, 0);
});

test('five simultaneous cancels of the same booking restore quantity exactly once', async () => {
  const l = await mk({ total: 4 });
  const { booking } = await book(buyers[0], l.id, 3);
  await book(buyers[1], l.id, 1);
  const rs = await Promise.all(Array.from({ length: 5 }, () => cancel(buyers[0], booking.id)));
  assert.equal(rs.filter((r) => !r.already_cancelled).length, 1);
  const v = await view(l.id);
  assert.equal(v.booked_quantity, 1);
  assert.equal(v.available_quantity, 3);
});

// ---------- cancellation ----------
test('cancel well before the cutoff restores availability, and a repeat does not restore twice', async () => {
  const l = await mk({ total: 4 });
  const { booking } = await book(buyers[0], l.id, 2);
  await book(buyers[1], l.id, 1);
  const first = await cancel(buyers[0], booking.id);
  assert.equal(first.already_cancelled, false);
  assert.equal(first.available_quantity, 3);
  const again = await cancel(buyers[0], booking.id);
  assert.equal(again.already_cancelled, true);
  assert.equal((await view(l.id)).available_quantity, 3);
});

test('only the buyer can cancel their booking', async () => {
  const l = await mk();
  const { booking } = await book(buyers[0], l.id, 1);
  await expectErr(cancel(buyers[1], booking.id), 'booking_not_found');
  await expectErr(cancel(seller, booking.id), 'booking_not_found');
});

test('cancellation cutoff is strict: allowed just before pickup-1h, blocked at it and after', async () => {
  // now() is fixed inside a transaction, so we can place the cutoff exactly.
  const scenario = (pickup) => tx(async (c) => {
    await asUser(c, buyers[0]);
    const l = await mkListing(c.query.bind(c), { total: 2, pickup });
    const { rows: [{ r }] } = await c.query('select book_listing($1, 1) as r', [l.id]);
    await c.query('savepoint s');
    try {
      await c.query('select cancel_booking($1)', [r.booking.id]);
      return { cancelled: true };
    } catch (e) {
      await c.query('rollback to savepoint s');
      const { rows: [v] } = await c.query('select booked_quantity from listings where id = $1', [l.id]);
      return { cancelled: false, code: e.message, booked: v.booked_quantity };
    }
  });
  const justBefore = await scenario('1 hour 1 microsecond');   // cutoff is 1µs in the future
  assert.deepEqual(justBefore, { cancelled: true });
  const atCutoff = await scenario('1 hour');                    // cutoff == now
  assert.deepEqual(atCutoff, { cancelled: false, code: 'cancellation_closed', booked: 1 });
  const inFinalHour = await scenario('59 minutes');
  assert.deepEqual(inFinalHour, { cancelled: false, code: 'cancellation_closed', booked: 1 });
});

test('a blocked cancellation reports the cutoff as exactly pickup minus one hour (6 PM -> 5 PM IST)', async () => {
  const l = await mk({ total: 2, pickup: '30 minutes' });
  const { booking } = await book(buyers[0], l.id, 1);
  await expectErr(cancel(buyers[0], booking.id), 'cancellation_closed', async (d) => {
    const { rows: [x] } = await pool.query(
      `select pickup_at - interval '1 hour' as cutoff,
              to_char((pickup_at - interval '1 hour') at time zone 'Asia/Kolkata', 'HH24:MI') as ist_cutoff,
              to_char(pickup_at at time zone 'Asia/Kolkata', 'HH24:MI') as ist_pickup
         from listings where id = $1`, [l.id]);
    assert.equal(new Date(d.cutoff).getTime(), x.cutoff.getTime());
    // One hour earlier on the IST wall clock, whatever the pickup time is.
    const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m + 1440) % 1440; };
    assert.equal(mins(x.ist_cutoff), (mins(x.ist_pickup) - 60 + 1440) % 1440);
  });
  assert.equal((await view(l.id)).booked_quantity, 1);
});

test('a cancellation on a sold-out listing frees the portions for new bookings', async () => {
  const l = await mk({ total: 2 });
  const { booking } = await book(buyers[0], l.id, 2);
  assert.equal((await view(l.id)).display_status, 'sold_out');
  await cancel(buyers[0], booking.id);
  assert.equal((await view(l.id)).display_status, 'available');
  const r = await book(buyers[1], l.id, 2);
  assert.equal(r.sold_out, true);
});

// ---------- seller edits ----------
test('seller cannot lower total below active bookings (4 booked, set 3 -> rejected)', async () => {
  const l = await mk({ total: 6 });
  await book(buyers[0], l.id, 4);
  await expectErr(edit(seller, l.id, { total_quantity: 3 }), 'quantity_below_booked',
    (d) => { assert.equal(d.booked, 4); assert.equal(d.requested, 3); });
  assert.equal((await view(l.id)).total_quantity, 6);
  const same = await edit(seller, l.id, { total_quantity: 4 });
  assert.equal(same.total_quantity, 4);
});

test('cancelled bookings no longer count toward the quantity floor', async () => {
  const l = await mk({ total: 6 });
  const { booking } = await book(buyers[0], l.id, 4);
  await cancel(buyers[0], booking.id);
  const r = await edit(seller, l.id, { total_quantity: 1 });
  assert.equal(r.total_quantity, 1);
});

test('increasing the total reopens a sold-out listing', async () => {
  const l = await mk({ total: 2 });
  await book(buyers[0], l.id, 2);
  await edit(seller, l.id, { total_quantity: 5 });
  const v = await view(l.id);
  assert.equal(v.display_status, 'available');
  assert.equal(v.available_quantity, 3);
});

test('price, time, place and title are frozen once someone has booked', async () => {
  const l = await mk();
  await book(buyers[0], l.id, 1);
  await expectErr(edit(seller, l.id, { price_paise: 20000 }), 'locked_after_booking',
    (d) => assert.deepEqual(d.fields, ['price_paise']));
  await expectErr(edit(seller, l.id, { pickup_at: new Date(Date.now() + 9 * 3600e3).toISOString() }), 'locked_after_booking');
  const ok = await edit(seller, l.id, { description: 'Now with extra basil' });
  assert.equal(ok.description, 'Now with extra basil');
});

test('with no bookings, a live listing can be fully edited; unknown fields are refused', async () => {
  const l = await mk();
  const r = await edit(seller, l.id, { price_paise: 18000, pickup_location: 'Tower A lobby' });
  assert.equal(r.price_paise, 18000);
  await expectErr(edit(seller, l.id, { booked_quantity: 0 }), 'unknown_fields');
  await expectErr(edit(seller, l.id, { status: 'draft' }), 'unknown_fields');
  await expectErr(edit(buyers[0], l.id, { price_paise: 1 }), 'listing_not_found');
});

// ---------- closing ----------
test('closing a listing cancels its bookings, notifies buyers and stops new bookings', async () => {
  const l = await mk({ total: 6 });
  await book(buyers[0], l.id, 2);
  await book(buyers[1], l.id, 1);
  const [{ close_listing: r }] = await call(seller, 'select close_listing($1)', [l.id]);
  assert.equal(r.cancelled_bookings, 2);
  const v = await view(l.id);
  assert.equal(v.display_status, 'closed');
  assert.equal(v.booked_quantity, 0);
  const n = await pool.query(`select user_id from notifications where listing_id = $1 and type = 'listing_closed'`, [l.id]);
  assert.deepEqual(n.rows.map((x) => x.user_id).sort(), [buyers[0], buyers[1]].sort());
  await expectErr(book(buyers[2], l.id, 1), 'listing_closed');
  const again = await cancel(buyers[0], (await pool.query('select id from bookings where listing_id=$1 and buyer_id=$2', [l.id, buyers[0]])).rows[0].id);
  assert.equal(again.already_cancelled, true);
});

test('a listing past its pickup time cannot be closed (that would cancel finished orders)', async () => {
  const l = await mk({ pickup: '-5 minutes' });
  await expectErr(call(seller, 'select close_listing($1)', [l.id]), 'listing_expired');
});

// ---------- joining ----------
test('joining a society works with an invite code, and not with a wrong one', async () => {
  const uid = crypto.randomUUID();
  await expectErr(call(uid, `select join_society('nope', 'New Person', 'D-9')`), 'invalid_invite_code');
  const [p] = await call(uid, `select * from join_society(' harmony-123 ', 'New Person', 'D-9')`);
  assert.equal(p.society_id, S1);
  await expectErr(call(uid, `select join_society('HARMONY-123', 'New Person', 'D-9')`), 'already_member');
});

// ---------- security ----------
test('RLS: members see their society listings, outsiders do not, drafts are private', async () => {
  const live = await mk();
  const draft = await mk({ status: 'draft' });
  const count = (uid, id) => tx(async (c) => {
    await asUser(c, uid);
    await c.query('set local role authenticated');
    return (await c.query('select count(*)::int as n from listings where id = $1', [id])).rows[0].n;
  });
  assert.equal(await count(buyers[0], live.id), 1);
  assert.equal(await count(outsider, live.id), 0);
  assert.equal(await count(buyers[0], draft.id), 0);
  assert.equal(await count(seller, draft.id), 1);
});

test('RLS: clients cannot write listings or bookings directly', async () => {
  const l = await mk();
  const attempt = (sql, params) => tx(async (c) => {
    await asUser(c, buyers[0]);
    await c.query('set local role authenticated');
    await c.query(sql, params);
  });
  await assert.rejects(attempt('update listings set booked_quantity = 0 where id = $1', [l.id]), { code: '42501' });
  await assert.rejects(attempt('update listings set total_quantity = 999 where id = $1', [l.id]), { code: '42501' });
  await assert.rejects(attempt(`insert into bookings (listing_id, buyer_id, quantity) values ($1, $2, 99)`, [l.id, buyers[0]]), { code: '42501' });
  await assert.rejects(attempt('select cancel_booking(gen_random_uuid())'), { message: 'booking_not_found' });
  await assert.rejects(attempt('select app_error(\'x\')'), { code: '42501' });
});

test('RLS: a buyer sees only their own bookings; the seller sees all bookings on their listing', async () => {
  const l = await mk();
  await book(buyers[0], l.id, 1);
  await book(buyers[1], l.id, 1);
  const seen = (uid) => tx(async (c) => {
    await asUser(c, uid);
    await c.query('set local role authenticated');
    return (await c.query('select count(*)::int as n from bookings where listing_id = $1', [l.id])).rows[0].n;
  });
  assert.equal(await seen(buyers[0]), 1);
  assert.equal(await seen(buyers[2]), 0);
  assert.equal(await seen(seller), 2);
});
