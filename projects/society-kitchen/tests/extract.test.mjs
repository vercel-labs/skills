import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractListing } from '../server/extract.mjs';

// Fixed "now": Sat 31 Oct 2026, 10:00 AM IST (= 04:30 UTC)
const NOW = new Date('2026-10-31T04:30:00Z');
const ist = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });

test('the PRD example is understood, with "6 people" flagged for confirmation', () => {
  const r = extractListing('Home-cooked pasta for 6 people, pickup at the clubhouse at 6 PM today, ₹150 per portion.', NOW);
  assert.equal(r.fields.title, 'Home-cooked pasta');
  assert.equal(r.fields.total_quantity, 6);
  assert.equal(r.fields.price_paise, 15000);
  assert.equal(r.fields.pickup_location, 'Clubhouse');
  assert.equal(ist(r.fields.pickup_at), '31/10/2026, 18:00:00');
  assert.deepEqual(r.confirm.map((c) => c.field), ['total_quantity']);
  assert.deepEqual(r.needs, []);
});

test('"tomorrow" resolves from the IST date, not UTC', () => {
  // 11:30 PM IST on 31 Oct is still 31 Oct IST (and 18:00 UTC).
  const late = new Date('2026-10-31T18:00:00Z');
  const r = extractListing('Rajma chawal, 5 portions, pickup from Tower A lobby at 1 pm tomorrow, Rs 120 each', late);
  assert.equal(ist(r.fields.pickup_at), '01/11/2026, 13:00:00');
  assert.equal(r.fields.total_quantity, 5);
  assert.equal(r.fields.price_paise, 12000);
  assert.equal(r.fields.pickup_location, 'Tower A lobby');
  assert.deepEqual(r.confirm, []);
});

test('weekday names pick the next occurrence', () => {
  const r = extractListing('Banana bread, 5 loaves, collect from the clubhouse at 11:30 am on Tuesday, ₹200 per loaf', NOW);
  assert.equal(ist(r.fields.pickup_at), '03/11/2026, 11:30:00'); // Tue 3 Nov 2026
});

test('it does not guess: missing price, place and day are reported', () => {
  const r = extractListing('Veg biryani, 8 portions, pickup at 7 pm', NOW);
  assert.equal(r.fields.price_paise, undefined);
  assert.equal(r.fields.pickup_at, undefined);
  assert.deepEqual(r.needs.map((n) => `${n.field}:${n.reason}`).sort(),
    ['pickup_at:no_day', 'price_paise:missing'].sort());
  assert.equal(r.fields.total_quantity, 8);
});

test('an ambiguous bare hour ("at 6") is not turned into a time', () => {
  const r = extractListing('Idli sambar for 4 people tomorrow, pickup at the lobby at 6, ₹80 per plate', NOW);
  assert.equal(r.fields.pickup_at, undefined);
  assert.equal(r.needs.find((n) => n.field === 'pickup_at').reason, 'ambiguous_time');
});

test('a time that has already passed today is refused, not moved to tomorrow', () => {
  const r = extractListing('Poha, 4 portions, pickup at the gate at 8 am today, ₹50 per portion', NOW);
  assert.equal(r.fields.pickup_at, undefined);
  assert.equal(r.needs.find((n) => n.field === 'pickup_at').reason, 'past');
});

test('a price with no unit asks whether it is per portion', () => {
  const r = extractListing('Cake, 10 slices tomorrow at 5 pm, pickup at the clubhouse, ₹900', NOW);
  assert.equal(r.fields.price_paise, 90000);
  assert.ok(r.confirm.some((c) => c.field === 'price_paise' && c.reason === 'unit'));
});

test('a title is always produced', () => {
  assert.equal(extractListing('Fresh dhokla', NOW).fields.title, 'Fresh dhokla');
  assert.equal(extractListing("I'm making rajma chawal for 4 people", NOW).fields.title, 'Rajma chawal');
});
