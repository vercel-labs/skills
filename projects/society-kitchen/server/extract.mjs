// Turns a seller's plain-language offer into draft fields.
//
// This is a deterministic, rule-based baseline: it only fills in what the text
// states clearly, and reports everything else instead of guessing:
//   needs:   fields it could not determine (the seller must provide them)
//   confirm: fields it did determine but that could be read two ways
//            (e.g. "for 6 people" -> 6 portions?)
// Nothing here publishes anything; the seller always reviews the draft.
// A Claude-powered extractor can replace this behind the same return shape.

const IST = 'Asia/Kolkata';

function istParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}
const istToDate = ({ y, m, d, h, mi }) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60000);
const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function extractListing(input, now = new Date()) {
  const text = String(input).replace(/\s+/g, ' ').trim();
  const fields = {};
  const confirm = [];
  const needs = [];

  // ---- quantity ----
  let m;
  if ((m = text.match(/\b(?:for|serves?|feeds?)\s+(\d+)\s*(?:people|persons?|ppl|pax|folks|guests|adults)\b/i))) {
    fields.total_quantity = +m[1];
    confirm.push({ field: 'total_quantity', reason: 'people', text: m[0] });
  } else if ((m = text.match(/\b(\d+)\s*(?:portions?|servings?|plates?|boxes|box|packs?|pieces?|pcs|bowls?|thalis?|loaves|loaf)\b/i))) {
    fields.total_quantity = +m[1];
  } else if ((m = text.match(/\bserves\s+(\d+)\b/i))) {
    fields.total_quantity = +m[1];
    confirm.push({ field: 'total_quantity', reason: 'people', text: m[0] });
  }
  if (!(fields.total_quantity > 0)) {
    delete fields.total_quantity;
    needs.push({ field: 'total_quantity', reason: 'missing' });
  }

  // ---- price ----
  const pm = text.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d{1,2})?)/i) || text.match(/(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\b\.?|rupees|inr)/i);
  if (pm) {
    fields.price_paise = Math.round(parseFloat(pm[1]) * 100);
    const after = text.slice(pm.index + pm[0].length, pm.index + pm[0].length + 24);
    if (!/^\s*(?:\/|per\b|each\b|a\b|apiece\b)/i.test(after)) {
      confirm.push({ field: 'price_paise', reason: 'unit', text: pm[0] });
    }
  } else {
    needs.push({ field: 'price_paise', reason: 'missing' });
  }

  // ---- pickup place ----
  const lm = text.match(/\b(?:pick\s?-?up|collect(?:ion)?)\s+(?:is\s+)?(?:at|from|in|near)\s+(?:the\s+)?(.+?)(?=\s+(?:at|on|by|around|from)\s+\d|\s+(?:today|tomorrow|tonight|tmrw)\b|[,.;]|$)/i);
  if (lm && lm[1].trim()) fields.pickup_location = cap(lm[1].trim());
  else needs.push({ field: 'pickup_location', reason: 'missing' });

  // ---- pickup time ----
  const today = istParts(now);
  let hh = null, mi = 0;
  let tm = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);
  if (tm) {
    hh = +tm[1] % 12; mi = tm[2] ? +tm[2] : 0;
    if (/^p/i.test(tm[3])) hh += 12;
    if (+tm[1] < 1 || +tm[1] > 12 || mi > 59) hh = null;
  } else if (/\b(noon|midday)\b/i.test(text)) {
    hh = 12;
  } else if ((tm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    hh = +tm[1]; mi = +tm[2];
  }
  const ambiguousTime = hh === null && /\b(?:at|by|around)\s+\d{1,2}\b(?!\s*(?::|am|pm|people|persons?|portions?|servings?|plates?|rs|₹))/i.test(text);

  let day = null;
  if (/\b(?:today|tonight)\b/i.test(text)) day = { ...today };
  else if (/\b(?:tomorrow|tmrw)\b/i.test(text)) day = addDays(today, 1);
  else {
    const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b|\\b${w.slice(0, 3)}\\b`, 'i').test(text));
    if (wd >= 0 && hh !== null) {
      for (let n = 0; n < 8 && !day; n++) {
        const cand = addDays(today, n);
        const dow = new Date(Date.UTC(cand.y, cand.m - 1, cand.d)).getUTCDay();
        if (dow === wd && istToDate({ ...cand, h: hh, mi }) > now) day = cand;
      }
    }
  }

  if (hh === null) {
    needs.push({ field: 'pickup_at', reason: ambiguousTime ? 'ambiguous_time' : 'no_time' });
  } else if (!day) {
    needs.push({ field: 'pickup_at', reason: 'no_day' });
  } else {
    const when = istToDate({ ...day, h: hh, mi });
    if (when <= now) needs.push({ field: 'pickup_at', reason: 'past' });
    else fields.pickup_at = when.toISOString();
  }

  // ---- title ----
  let t = text.replace(/^(?:hi|hello|hey)[,!\s]+/i, '');
  t = t.replace(/^(?:i(?:'m| am)?|we(?:'re| are)?|i have|i've got|we have)\s+/i, '');
  t = t.replace(/^(?:making|offering|selling|cooking|baking|preparing|serving)\s+/i, '');
  const cut = t.search(/\s+(?:for\s+\d|serves?\s+\d|pick\s?-?up|collect|at\s+\d|(?:₹|rs\.?|inr)\s*\d|\d+\s*(?:portions?|servings?|plates?))|[,.;!]/i);
  let title = (cut > 0 ? t.slice(0, cut) : t).trim();
  if (!title) title = text.split(' ').slice(0, 5).join(' ');
  fields.title = cap(title);

  return { fields, confirm, needs };
}
