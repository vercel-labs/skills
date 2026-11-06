'use strict';
// Society Kitchen web app. No framework, no build step.
// All business rules live in the database; this file shows state and sends intent.

// ---------- tiny helpers ----------
const TZ = 'Asia/Kolkata';
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const ICONS = {
  bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7.5c0-1.5 1-2 1-3.5M12 7.5c0-1.5 1-2 1-3.5M16 7.5c0-1.5 1-2 1-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  rupee: '<path d="M6 4h12M6 9h12M9 4c5 0 6 5 0 5l7 7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  addcircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  seal: '<path d="M12 3l2.6 2.2 3.4-.2.7 3.3 2.8 1.9-1.3 3.1 1.3 3.1-2.8 1.9-.7 3.3-3.4-.2L12 21l-2.6-2.2-3.4.2-.7-3.3L2.5 13.8l1.3-3.1L2.5 7.6l2.8-1.9.7-3.3 3.4.2z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
};
const svg = (n, size = 20, sw = 1.8, attrs = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${ICONS[n]}</svg>`;

// ---------- dates (all shown in IST) ----------
const fmt = (opts) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts });
const partsOf = (iso, opts) => Object.fromEntries(fmt(opts).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
const fmtTime = (iso) => { const p = partsOf(iso, { hour: 'numeric', minute: '2-digit', hour12: true }); return `${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`; };
const fmtDay = (iso) => { const p = partsOf(iso, { weekday: 'short', day: 'numeric', month: 'short' }); return `${p.weekday} ${p.day} ${p.month}`; };
const fmtWhen = (iso) => `${fmtDay(iso)} · ${fmtTime(iso)}`;
const dateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const toLocalInput = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const dayLabel = (iso) => {
  const k = dateKey(iso);
  if (k === dateKey(Date.now())) return 'Today';
  if (k === dateKey(Date.now() - 864e5)) return 'Yesterday';
  return fmtDay(iso);
};
const rupees = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const portions = (n, unit = 'portion') => `${n} ${unit}${n === 1 ? '' : 's'}`;

// ---------- state, api, feedback ----------
const state = { uid: store.get('uid'), authMode: 'otp', account: null, phone: '', me: null, unread: 0, filter: 'all', bTab: 'upcoming', sTab: 'active', createTab: 'describe',
  lastBooking: null, conflict: null, notes: {}, ack: {} };
let ui = {};

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-sk': '1', ...(state.authMode === 'dev' && state.uid ? { 'x-user-id': state.uid } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || 'error'); e.code = j.error || 'error'; e.detail = j.detail || {}; e.status = res.status; throw e; }
  return j;
}

function errorText(e) {
  const d = e.detail || {};
  switch (e.code) {
    case 'insufficient_capacity': return `Only ${d.available} left now.`;
    case 'sold_out': return 'This offer just sold out.';
    case 'cancellation_closed': return d.cutoff ? `Cancellation closed at ${fmtTime(d.cutoff)}.` : 'Cancellation is closed.';
    case 'quantity_below_booked': return `You can't go below ${d.booked}. ${portions(d.booked)} already booked.`;
    case 'missing_fields': return `Still needed: ${(d.fields || []).map(fieldLabel).join(', ')}.`;
    case 'locked_after_booking': return 'That can\'t be changed once someone has booked.';
    case 'listing_expired': return 'The pickup time has passed.';
    case 'listing_closed': return 'This offer was closed by the seller.';
    case 'pickup_in_past': return 'Pickup time must be in the future.';
    case 'cannot_book_own_listing': return "You can't book your own listing.";
    case 'invalid_quantity': return 'Enter a quantity of 1 or more.';
    case 'invalid_value': return 'That value isn\'t valid.';
    case 'listing_not_found': case 'booking_not_found': return 'We couldn\'t find that.';
    case 'invalid_pin': return 'Your PIN must be exactly 6 digits.';
    case 'invalid_credentials': return d.attempts_left != null ? `Name, flat or PIN doesn't match. ${d.attempts_left} ${d.attempts_left === 1 ? 'try' : 'tries'} left.` : 'Name, flat or PIN doesn\'t match.';
    case 'account_locked': return 'Too many wrong PINs. Try again in 15 minutes.';
    case 'already_registered': return 'That name and flat are already registered. Use "I already have an account".';
    case 'invalid_phone': return 'Enter a valid 10-digit mobile number.';
    case 'otp_invalid': return d.attempts_left != null ? `That code isn't right. ${d.attempts_left} ${d.attempts_left === 1 ? 'try' : 'tries'} left.` : 'That code isn\'t right or has expired. Ask for a new one.';
    case 'too_many_attempts': return 'Too many wrong tries. Ask for a new code.';
    case 'otp_too_soon': return `Please wait ${d.retry_after || 30} seconds before asking again.`;
    case 'otp_rate_limited': return 'Too many attempts. Please try again later.';
    case 'otp_send_failed': return 'We couldn\'t send the code. Please try again.';
    case 'invalid_invite_code': return 'That invite code isn\'t right. Ask your society committee for it.';
    case 'already_member': return 'You\'re already part of a society.';
    case 'csrf': return 'Please reload the page and try again.';
    case 'text_required': return 'Tell us a little about what you\'re making.';
    default: return 'Something went wrong. Please try again.';
  }
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
const closeOverlay = () => { $('#overlay').innerHTML = ''; };
function on(root, action, fn) { $$(`[data-action="${action}"]`, root).forEach((el) => el.addEventListener('click', (ev) => fn(el, ev))); }

// ---------- shared pieces ----------
const PALETTE = [['#FFF1D6', '#8A5A00'], ['#FBE6E1', '#9C3B2E'], ['#F5E6EE', '#8A3A66'], ['#E1F0EA', '#14614A'], ['#E6EDF7', '#2F4E8A']];
function tile(title, size = 72) {
  let h = 0; for (const ch of String(title)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[h % PALETTE.length];
  return `<div class="tile" style="width:${size}px;height:${size}px;background:${bg};color:${fg}">${svg('bowl', Math.round(size * 0.44), 1.6)}</div>`;
}
function statusChip(l) {
  switch (l.display_status) {
    case 'sold_out': return '<span class="chip grey">Sold out</span>';
    case 'expired': return '<span class="chip grey">Pickup passed</span>';
    case 'closed': return '<span class="chip grey">Closed</span>';
    case 'draft': return '<span class="chip warn">Draft</span>';
    default: {
      const left = l.available_quantity;
      return left <= 2 ? `<span class="chip warn">Only ${left} left</span>` : `<span class="chip ok">${left} of ${l.total_quantity} left</span>`;
    }
  }
}
const topbar = (title, href) => `<div class="topbar"><a class="iconbtn" href="${href}" aria-label="Back">${svg('back', 22, 2)}</a>${title ? `<h1 class="title" style="font-size:18px">${esc(title)}</h1>` : ''}</div>`;
const initials = (name) => String(name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fact = (icon, k, v) => `<div class="fact">${svg(icon, 20)}<div class="col"><div class="k">${k}</div><div class="v">${v}</div></div></div>`;
const bars = (total, booked, remainingStyle) => {
  const n = Math.min(total, 12); const filled = Math.round((booked / total) * n);
  return `<div class="bars" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < filled ? '' : (remainingStyle === 'left' ? 'left' : 'free')}"></i>`).join('')}</div>`;
};
const banner = (kind, icon, html) => `<div class="banner ${kind}">${svg(icon, 18, 2)}<div>${html}</div></div>`;

// ---------- screens ----------
const rootOf = () => $('#screen');
const fieldErr = (root, msg) => { const el = $('#err', root); if (el) { el.textContent = msg || ''; el.hidden = !msg; } };

async function login() {
  if (state.authMode === 'dev') return devLogin();
  if (state.authMode === 'link') return linkLogin();
  const step = ui.step === 'code' && state.phone ? 'code' : 'phone';
  if (step === 'phone') {
    return {
      html: `<div class="page-head"><h1 class="h1">Society Kitchen</h1><p class="sub">Home-cooked food from your neighbours. Sign in with your mobile number.</p></div>
        <form class="stack" id="f" novalidate>
          <label class="lab" for="phone">Mobile number</label>
          <div class="row gap6"><span class="field" style="width:64px;display:flex;align-items:center;justify-content:center">+91</span>
          <input class="field" id="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="98765 43210" value="${esc(state.phone.replace(/^\+91/, ''))}" aria-describedby="err"></div>
          <p class="small" id="err" role="alert" style="color:var(--danger)" hidden></p>
          <button class="btn" id="go" type="submit">Send code</button>
          <p class="small">We'll text you a 6-digit code. Standard SMS rates may apply.</p>
        </form>`,
      bind: (root) => {
        $('#phone', root).focus();
        $('#f', root).addEventListener('submit', async (ev) => {
          ev.preventDefault(); const btn = $('#go', root); const v = $('#phone', root).value.trim();
          btn.disabled = true; fieldErr(root, '');
          try {
            await api('POST', '/api/auth/request-otp', { phone: /^\+/.test(v) ? v : '+91' + v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '') });
            state.phone = /^\+/.test(v) ? v : '+91' + v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
            state.resendAt = Date.now() + 30000; ui.step = 'code'; route();
          } catch (e) { fieldErr(root, errorText(e)); btn.disabled = false; }
        });
      },
    };
  }
  return {
    html: `<div class="topbar"><button class="iconbtn" id="back" aria-label="Use a different number">${svg('back', 22, 2)}</button></div>
      <div class="page-head"><h1 class="h1">Enter your code</h1><p class="sub">We sent a 6-digit code to ${esc(state.phone)}.</p></div>
      <form class="stack" id="f" novalidate>
        <label class="lab" for="code">6-digit code</label>
        <input class="field" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" style="letter-spacing:8px;font-size:22px;text-align:center" aria-describedby="err">
        <p class="small" id="err" role="alert" style="color:var(--danger)" hidden></p>
        <button class="btn" id="go" type="submit">Verify</button>
        <button class="btn outline" id="resend" type="button" disabled>Resend code</button>
      </form>`,
    bind: (root) => {
      $('#code', root).focus();
      const resend = $('#resend', root);
      const tick = () => {
        const left = Math.ceil(((state.resendAt || 0) - Date.now()) / 1000);
        resend.disabled = left > 0; resend.textContent = left > 0 ? `Resend code in ${left}s` : 'Resend code';
      };
      tick(); ui.timer = setInterval(tick, 1000);
      $('#back', root).addEventListener('click', () => { ui.step = 'phone'; route(); });
      resend.addEventListener('click', async () => {
        resend.disabled = true; fieldErr(root, '');
        try { await api('POST', '/api/auth/request-otp', { phone: state.phone }); state.resendAt = Date.now() + 30000; toast('New code sent.'); }
        catch (e) { fieldErr(root, errorText(e)); if (e.code === 'otp_too_soon') state.resendAt = Date.now() + (e.detail.retry_after || 30) * 1000; }
        tick();
      });
      $('#f', root).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const btn = $('#go', root); const code = $('#code', root).value.replace(/\D/g, '');
        if (code.length !== 6) return fieldErr(root, 'Enter the 6-digit code.');
        btn.disabled = true; fieldErr(root, '');
        try {
          const r = await api('POST', '/api/auth/verify-otp', { phone: state.phone, code });
          state.phone = ''; ui.step = null; state.filter = 'all';
          location.hash = r.has_profile ? '#/' : '#/join'; await route();
        } catch (e) { fieldErr(root, errorText(e)); btn.disabled = false; $('#code', root).select(); if (e.code === 'too_many_attempts') $('#code', root).value = ''; }
      });
    },
  };
}

async function linkLogin() {
  const signup = state.linkMode !== 'signin';
  const invite = store.get('invite') || '';
  return {
    html: `<div class="page-head"><h1 class="h1">Society Kitchen</h1><p class="sub">Home-cooked food from your neighbours.</p></div>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="${signup}" class="${signup ? 'on' : ''}" data-action="mode" data-m="signup">New here</button>
        <button role="tab" aria-selected="${!signup}" class="${!signup ? 'on' : ''}" data-action="mode" data-m="signin">I have an account</button></div>
      <form class="stack" id="f" novalidate>
        <div><label class="lab" for="invite">Society invite code</label><input class="field" id="invite" autocapitalize="characters" autocomplete="off" placeholder="e.g. MAPLE-123" value="${esc(invite)}"></div>
        <div><label class="lab" for="name">Your name</label><input class="field" id="name" autocomplete="name" maxlength="60"></div>
        <div><label class="lab" for="flat">Flat / unit</label><input class="field" id="flat" autocomplete="off" maxlength="20" placeholder="e.g. B-402"></div>
        <div><label class="lab" for="pin">${signup ? 'Choose a 6-digit PIN' : 'Your 6-digit PIN'}</label><input class="field" id="pin" type="password" inputmode="numeric" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="6"></div>
        <p class="small">${signup ? "Remember your PIN: it's how you sign back in on a new phone. Neighbours see your name and flat." : ''}</p>
        <p class="small" id="err" role="alert" style="color:var(--danger)" hidden></p>
        <button class="btn" id="go" type="submit">${signup ? 'Join and continue' : 'Sign in'}</button>
      </form>`,
    bind: (root) => {
      on(root, 'mode', (el) => { state.linkMode = el.dataset.m; route(); });
      $(invite ? '#name' : '#invite', root).focus();
      $('#f', root).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const btn = $('#go', root);
        const body = { invite_code: $('#invite', root).value.trim(), display_name: $('#name', root).value.trim(), flat_label: $('#flat', root).value.trim(), pin: $('#pin', root).value };
        if (!body.invite_code || !body.display_name || !body.flat_label || !body.pin) return fieldErr(root, 'Fill in every field.');
        btn.disabled = true; fieldErr(root, '');
        try { await api('POST', signup ? '/api/auth/signup' : '/api/auth/login', body); store.set('invite', body.invite_code); state.filter = 'all'; location.hash = '#/'; await route(); }
        catch (e) { fieldErr(root, errorText(e)); btn.disabled = false; $('#pin', root).value = ''; }
      });
    },
  };
}

async function devLogin() {
  const { users } = await api('GET', '/api/dev/users');
  const groups = users.reduce((m, u) => ((m[u.society] ||= []).push(u), m), {});
  return {
    html: `<div class="page-head"><h1 class="h1">Society Kitchen</h1><p class="sub">Home-cooked food from your neighbours.</p></div>
      <div class="pad" style="padding-bottom:12px">${banner('warn', 'info', 'Development sign-in: choose a resident to try the app. Never run this mode on the internet.')}</div>
      <div class="stack">${Object.entries(groups).map(([soc, us]) => `
        <h2 class="title" style="margin-top:8px">${esc(soc)}</h2>
        ${us.map((u) => `<button class="userbtn" data-action="pick" data-uid="${esc(u.id)}"><span class="avatar">${esc(initials(u.display_name))}</span>
          <span class="col"><b>${esc(u.display_name)}</b><span class="small">${esc(u.flat_label)}</span></span></button>`).join('')}`).join('')}</div>`,
    bind: (root) => on(root, 'pick', (el) => { state.uid = el.dataset.uid; store.set('uid', state.uid); state.filter = 'all'; location.hash = '#/'; route(); }),
  };
}

async function join() {
  return {
    html: `<div class="page-head"><h1 class="h1">Join your society</h1><p class="sub">Only residents can buy and sell here. Ask your society committee for the invite code.</p></div>
      <form class="stack" id="f" novalidate>
        <div><label class="lab" for="invite">Invite code</label><input class="field" id="invite" autocapitalize="characters" autocomplete="off" placeholder="e.g. MAPLE-123"></div>
        <div><label class="lab" for="name">Your name</label><input class="field" id="name" autocomplete="name" maxlength="60"></div>
        <div><label class="lab" for="flat">Flat / unit</label><input class="field" id="flat" autocomplete="off" maxlength="20" placeholder="e.g. B-402"></div>
        <p class="small">Neighbours see your name and flat on listings and bookings.</p>
        <p class="small" id="err" role="alert" style="color:var(--danger)" hidden></p>
        <button class="btn" id="go" type="submit">Join</button>
        <button class="btn outline" type="button" id="out">Use a different number</button>
      </form>`,
    bind: (root) => {
      $('#invite', root).focus();
      $('#out', root).addEventListener('click', logout);
      $('#f', root).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const btn = $('#go', root);
        const invite_code = $('#invite', root).value.trim(), display_name = $('#name', root).value.trim(), flat_label = $('#flat', root).value.trim();
        if (!invite_code || !display_name || !flat_label) return fieldErr(root, 'Fill in all three fields.');
        btn.disabled = true; fieldErr(root, '');
        try { await api('POST', '/api/auth/join', { invite_code, display_name, flat_label }); await refreshMe(); location.hash = '#/'; await route(); }
        catch (e) { fieldErr(root, errorText(e)); btn.disabled = false; }
      });
    },
  };
}

async function account() {
  const m = state.me;
  return {
    html: `${topbar('Account', '#/')}
      <div class="stack" style="padding-top:12px">
        <div class="row gap6"><span class="avatar">${esc(initials(m.display_name))}</span><div class="col"><b>${esc(m.display_name)}</b><span class="small">${esc(m.flat_label)} · ${esc(m.society_name)}</span></div></div>
        ${state.account?.phone ? `<div class="fact">${svg('user', 20)}<div class="col"><div class="k">Mobile number</div><div class="v">${esc(state.account.phone)}</div></div></div>` : ''}
        ${m.invite_code ? `<div class="fact">${svg('info', 20)}<div class="col"><div class="k">Invite neighbours</div><div class="v">Code ${esc(m.invite_code)}</div></div></div><button class="btn" id="invite">Share invite link</button>` : ''}
        <button class="btn outline" id="logout">Log out</button>
        ${state.authMode === 'dev' ? '<button class="btn neutral" id="switch">Switch user (dev)</button>' : ''}
      </div>`,
    bind: (root) => {
      $('#invite', root)?.addEventListener('click', async () => {
        const url = `${location.origin}/?join=${encodeURIComponent(m.invite_code)}`;
        const text = `Join ${m.society_name} on Society Kitchen to buy and sell home-cooked food: ${url}`;
        try { if (navigator.share) await navigator.share({ title: 'Society Kitchen', text }); else { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it in your group.'); } }
        catch (e) { if (e.name !== 'AbortError') toast('Could not share. Copy this link: ' + url); }
      });
      $('#logout', root).addEventListener('click', logout);
      $('#switch', root)?.addEventListener('click', () => { state.uid = ''; store.set('uid', ''); state.account = null; state.me = null; location.hash = '#/login'; route(); });
    },
  };
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch {}
  state.account = null; state.me = null; state.unread = 0; state.uid = ''; store.set('uid', ''); ui.step = null; state.phone = '';
  location.hash = '#/login'; route();
}

async function browse() {
  const { listings } = await api('GET', '/api/listings');
  const tomorrow = dateKey(Date.now() + 864e5);
  const shown = listings.filter((l) => state.filter === 'tomorrow' ? dateKey(l.pickup_at) === tomorrow : state.filter === 'available' ? l.display_status === 'available' : true);
  const chip = (k, label) => `<button class="chipbtn ${state.filter === k ? 'on' : ''}" data-action="filter" data-k="${k}" aria-pressed="${state.filter === k}">${label}</button>`;
  return {
    html: `<div class="page-head">
        <div class="row between"><div class="row gap6 small" style="font-weight:600;font-size:14px">${svg('pin', 18)}${esc(state.me?.society_name || '')}</div>
        <a class="iconbtn" href="#/account" aria-label="Account: ${esc(state.me?.display_name || '')}" style="background:var(--soft)">${svg('user', 22)}</a></div>
        <h1 class="h1">What's cooking</h1><p class="sub">${shown.length} ${shown.length === 1 ? 'offer' : 'offers'} from your neighbours</p></div>
      <div class="chips">${chip('all', 'All')}${chip('tomorrow', 'Tomorrow')}${chip('available', 'Available only')}</div>
      <div class="stack" style="flex:1">${shown.length ? shown.map((l) => `
        <a class="card link" href="#/listing/${esc(l.id)}">${tile(l.title)}
          <div class="grow col gap4"><div class="title">${esc(l.title)}</div>
            <div class="small">${esc(l.seller_name)} · ${esc(l.seller_flat)}${l.is_mine ? ' · <b>You</b>' : ''}</div>
            <div class="row gap6" style="font-size:13px;color:#2B3A34">${svg('clock', 14, 2)}${esc(fmtWhen(l.pickup_at))} · ${esc(l.pickup_location)}</div>
            <div class="row between" style="margin-top:4px"><div class="price">${rupees(l.price_paise)} <small>/ portion</small></div>${statusChip(l)}</div></div></a>`).join('')
      : `<div class="empty"><p>No offers here right now.</p><a class="btn sm" href="#/sell/new">Offer something you've cooked</a></div>`}</div>`,
    bind: (root) => on(root, 'filter', (el) => { state.filter = el.dataset.k; route(); }),
  };
}

async function listing(id) {
  const { listing: l } = await api('GET', `/api/listings/${id}`);
  const open = l.display_status === 'available' && !l.is_mine;
  const cutoffOpen = new Date(l.cancel_cutoff) > new Date();
  const closedLabel = { sold_out: 'Sold out', expired: 'No longer bookable', closed: 'Offer closed', draft: 'Not published' }[l.display_status] || 'Unavailable';
  const footer = l.is_mine
    ? `<div class="footer"><a class="btn" href="#/sell/manage/${esc(l.id)}">Manage your listing</a></div>`
    : open ? `<div class="footer">
        <div class="row between"><div class="small" style="font-weight:600;font-size:14px">Portions</div>
          <div class="stepper"><button class="iconbtn" id="dec" aria-label="One fewer portion">${svg('minus', 20, 2)}</button><div class="num" id="qty" aria-live="polite">1</div><button class="iconbtn" id="inc" aria-label="One more portion">${svg('plus', 20, 2)}</button></div></div>
        <button class="btn" id="book"></button>
        <div class="note">Confirmed instantly. Payment is settled offline with the seller.</div></div>`
      : `<div class="footer"><button class="btn" disabled>${closedLabel}</button></div>`;
  return {
    html: `<div class="hero"><a class="iconbtn" href="#/" aria-label="Back to offers">${svg('back', 22, 2)}</a>${`<span style="color:#8A5A00">${svg('bowl', 72, 1.2)}</span>`}</div>
      <div class="col gap16 grow pad" style="padding-top:18px;padding-bottom:16px">
        <div class="col gap8"><div style="align-self:flex-start">${statusChip(l)}</div><h1 class="h1" style="font-size:25px;line-height:30px">${esc(l.title)}</h1>
          <div class="row gap10"><div class="avatar">${esc(initials(l.seller_name))}</div><div class="col"><b style="font-size:15px">${esc(l.seller_name)}</b><span class="small">${esc(l.seller_flat)}</span></div></div></div>
        <div class="facts">
          ${fact('clock', 'Pickup', `${esc(fmtWhen(l.pickup_at))} IST`)}
          ${fact('pin', 'Where', esc(l.pickup_location))}
          ${fact('rupee', 'Price', `${rupees(l.price_paise)} per portion · pay ${esc(l.seller_name.split(' ')[0])} directly`)}
          ${fact('shield', 'Cancellation', cutoffOpen ? `Free until ${esc(fmtTime(l.cancel_cutoff))} IST. Closed in the last hour before pickup.` : 'Cancellation is closed for this offer.')}
        </div>
        ${l.description ? `<div class="col gap4"><b style="font-size:15px">About this dish</b><p style="font-size:14.5px;line-height:21px;color:#2B3A34">${esc(l.description)}</p></div>` : ''}
      </div>${footer}`,
    bind: (root) => {
      if (!open) return;
      let q = 1; const max = l.available_quantity;
      const paint = () => {
        $('#qty', root).textContent = q; $('#dec', root).disabled = q <= 1; $('#inc', root).disabled = q >= max;
        $('#book', root).textContent = `Book ${portions(q)} · ${rupees(q * l.price_paise)}`;
      };
      $('#dec', root).addEventListener('click', () => { q = Math.max(1, q - 1); paint(); });
      $('#inc', root).addEventListener('click', () => { q = Math.min(max, q + 1); paint(); });
      $('#book', root).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
          const r = await api('POST', `/api/listings/${l.id}/book`, { quantity: q });
          state.lastBooking = { booking: r.booking, listing: l };
          location.hash = '#/booked';
        } catch (e) {
          if (e.code === 'insufficient_capacity' || e.code === 'sold_out') {
            state.conflict = { id: l.id, requested: q, available: e.detail.available ?? 0 };
            location.hash = '#/conflict';
          } else { toast(errorText(e)); route(); }
        }
      });
      paint();
    },
  };
}

async function booked() {
  const lb = state.lastBooking;
  if (!lb) { location.hash = '#/bookings'; return null; }
  const { booking: b, listing: l } = lb;
  return {
    html: `<div class="col center gap12" style="padding:72px 20px 0"><div class="success"><div>${svg('check', 30, 2.4)}</div></div>
        <h1 class="h1">You're booked</h1><p class="sub" style="max-width:300px">Your ${b.quantity === 1 ? 'portion is' : 'portions are'} reserved. ${esc(l.seller_name.split(' ')[0])} has been notified.</p></div>
      <div class="pad" style="margin-top:32px"><div class="card" style="padding:0;border-radius:18px;overflow:hidden">
        <div class="row gap12" style="padding:16px;background:var(--soft)">${tile(l.title, 48)}<div class="col"><b style="font-size:17px;font-weight:800">${esc(l.title)}</b><span class="small">${portions(b.quantity)} · ${rupees(b.quantity * l.price_paise)}</span></div></div>
        <div class="col gap12" style="padding:16px">
          <div class="kv"><span class="k">Pickup</span><span class="v">${esc(fmtWhen(l.pickup_at))} IST</span></div>
          <div class="kv"><span class="k">Where</span><span class="v">${esc(l.pickup_location)}</span></div>
          <div class="kv"><span class="k">Seller</span><span class="v">${esc(l.seller_name)} · ${esc(l.seller_flat)}</span></div>
          <div class="kv"><span class="k">Booked</span><span class="v">${esc(fmtWhen(b.created_at))}</span></div></div></div></div>
      <div class="stack" style="padding-top:14px">${banner('warn', 'info', `Pay ${rupees(b.quantity * l.price_paise)} to ${esc(l.seller_name.split(' ')[0])} when you pick up. Payments aren't handled in the app.`)}
        <p class="small" style="padding:0 4px">You can cancel for free until ${esc(fmtTime(l.cancel_cutoff))} IST on ${esc(fmtDay(l.cancel_cutoff))}.</p></div>
      <div class="stack" style="margin-top:auto;padding-bottom:24px"><a class="btn" href="#/bookings">View my bookings</a><a class="btn outline" href="#/">Back to offers</a></div>`,
  };
}

async function conflict() {
  const c = state.conflict;
  if (!c) { location.hash = '#/'; return null; }
  const { listing: l } = await api('GET', `/api/listings/${c.id}`);
  const left = l.available_quantity;
  return {
    html: `${topbar('', `#/listing/${esc(l.id)}`)}
      <div class="stack" style="gap:18px;flex:1">
        <div class="banner big"><div class="row gap10">${svg('warn', 26, 2)}<h1 class="h2">Someone booked just before you</h1></div>
          <div style="font-weight:500">${left > 0 ? `You asked for ${portions(c.requested)}, but only ${left} ${left === 1 ? 'is' : 'are'} left now. Nothing was booked.` : `You asked for ${portions(c.requested)}, but this offer just sold out. Nothing was booked.`}</div></div>
        <div class="card row gap12">${tile(l.title, 60)}<div class="col gap4"><div class="title">${esc(l.title)}</div><div class="small">${esc(l.seller_name)} · ${esc(l.seller_flat)}</div><div style="font-size:13px;color:#2B3A34">${esc(fmtWhen(l.pickup_at))} · ${esc(l.pickup_location)}</div></div></div>
        <div class="card col gap10" style="background:var(--soft);border:0;padding:16px">
          <div class="row between" style="align-items:baseline"><span class="small" style="font-weight:600;font-size:14px">Available now</span><span style="font-size:26px;font-weight:800;color:${left ? '#7A4A00' : 'var(--ink)'}">${left} <span class="small" style="font-size:14px;font-weight:600">of ${l.total_quantity} portions</span></span></div>
          ${bars(l.total_quantity, l.booked_quantity, 'left')}
          <div class="small">${l.display_status === 'available' ? `Cancellations may free up more portions before ${esc(fmtTime(l.cancel_cutoff))} IST.` : 'If someone cancels, portions come back on offer.'}</div></div></div>
      <div class="footer">${left > 0 && l.display_status === 'available' ? `<button class="btn" data-action="rebook">Book ${portions(left)} · ${rupees(left * l.price_paise)}</button>` : ''}<a class="btn outline" href="#/">Back to offers</a></div>`,
    bind: (root) => on(root, 'rebook', async (el) => {
      el.disabled = true;
      try { const r = await api('POST', `/api/listings/${l.id}/book`, { quantity: left }); state.lastBooking = { booking: r.booking, listing: l }; location.hash = '#/booked'; }
      catch (e) { if (e.code === 'insufficient_capacity' || e.code === 'sold_out') { state.conflict = { id: l.id, requested: left, available: e.detail.available ?? 0 }; route(); } else { toast(errorText(e)); route(); } }
    }),
  };
}

async function bookings() {
  const { bookings: all } = await api('GET', '/api/bookings');
  const isUpcoming = (b) => b.status === 'confirmed' && !b.is_past;
  const upcoming = all.filter(isUpcoming).sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at));
  const past = all.filter((b) => !isUpcoming(b)).sort((a, b) => new Date(b.pickup_at) - new Date(a.pickup_at));
  const list = state.bTab === 'upcoming' ? upcoming : past;
  const card = (b) => {
    const chip = b.status === 'cancelled' ? '<span class="chip grey">Cancelled</span>' : b.is_past ? '<span class="chip grey">Past</span>' : '<span class="chip ok">Confirmed</span>';
    let foot = '';
    if (b.status === 'cancelled') foot = `<div class="small">${b.cancel_reason === 'seller_closed' ? 'The seller closed this offer.' : 'You cancelled this booking.'}</div>`;
    else if (!b.is_past) foot = b.can_cancel
      ? `<div class="small" style="line-height:17px">Free cancellation until ${esc(fmtTime(b.cancel_cutoff))}</div><button class="btn sm danger-outline" data-action="cancel" data-id="${esc(b.id)}">Cancel booking</button>`
      : `<div class="row gap6 small" style="line-height:17px">${svg('lock', 16, 2)}Cancellation closed at ${esc(fmtTime(b.cancel_cutoff))}</div><button class="btn sm" disabled>Cancel</button>`;
    return `<div class="card pad14 col gap10" data-booking="${esc(b.id)}">
      <div class="row between" style="align-items:flex-start;gap:8px"><div class="col"><div class="title">${esc(b.title)}</div><div class="small">${portions(b.quantity, b.quantity_unit)} · ${rupees(b.quantity * b.price_paise)} · ${esc(b.seller_name)}</div></div>${chip}</div>
      <div style="font-size:13.5px;font-weight:600;color:#2B3A34">${esc(fmtWhen(b.pickup_at))} · ${esc(b.pickup_location)}</div>
      ${foot ? `<div class="row between gap10" style="padding-top:10px;border-top:1px solid var(--line)">${foot}</div>` : ''}</div>`;
  };
  return {
    html: `<div class="page-head"><h1 class="h1">My bookings</h1></div>
      <div class="seg" role="tablist"><button class="${state.bTab === 'upcoming' ? 'on' : ''}" data-action="tab" data-k="upcoming">Upcoming (${upcoming.length})</button><button class="${state.bTab === 'past' ? 'on' : ''}" data-action="tab" data-k="past">Past (${past.length})</button></div>
      <div class="stack" style="flex:1">${list.length ? list.map(card).join('') : `<div class="empty"><p>${state.bTab === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here yet.'}</p><a class="btn sm" href="#/">See what's cooking</a></div>`}</div>`,
    bind: (root) => {
      on(root, 'tab', (el) => { state.bTab = el.dataset.k; route(); });
      on(root, 'cancel', (el) => {
        const b = all.find((x) => x.id === el.dataset.id);
        $('#overlay').innerHTML = `<div class="sheet-wrap"><div class="sheet" role="dialog" aria-modal="true" aria-label="Cancel this booking"><div class="grab"></div>
          <div class="col gap6"><h2 class="h2">Cancel this booking?</h2><p class="sub" style="font-size:14.5px;line-height:21px">You can cancel for free until ${esc(fmtTime(b.cancel_cutoff))} IST on ${esc(fmtDay(b.cancel_cutoff))}.</p></div>
          <div class="row gap12" style="padding:12px;border-radius:14px;background:var(--soft)">${tile(b.title, 48)}<div class="col"><b style="font-size:15.5px">${esc(b.title)}</b><span class="small">${portions(b.quantity, b.quantity_unit)} · ${esc(fmtWhen(b.pickup_at))}</span></div></div>
          <div class="row gap10 small" style="align-items:flex-start;font-size:13.5px;line-height:19px;color:#2B3A34">${svg('info', 18, 2)}<span>The portion goes back to the offer straight away, so a neighbour can book it. This can't be undone.</span></div>
          <div class="col gap10"><button class="btn danger" id="yes">Yes, cancel booking</button><button class="btn neutral" id="no">Keep my booking</button></div></div></div>`;
        $('#no').focus();
        $('#no').addEventListener('click', closeOverlay);
        $('#yes').addEventListener('click', async (ev) => {
          ev.target.disabled = true;
          try { await api('POST', `/api/bookings/${b.id}/cancel`); closeOverlay(); toast('Booking cancelled. The portion is back on offer.'); }
          catch (e) { closeOverlay(); toast(errorText(e)); }
          route();
        });
      });
    },
  };
}

// ---------- seller ----------
const FIELDS = [
  { key: 'title', label: 'Dish', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea', ph: "What's in it? Veg or non-veg?" },
  { key: 'total_quantity', label: 'Portions', type: 'int' },
  { key: 'price_paise', label: 'Price per portion', type: 'price' },
  { key: 'pickup_at', label: 'Pickup', type: 'datetime' },
  { key: 'pickup_location', label: 'Pickup spot', type: 'text' },
];
const fieldLabel = (k) => (FIELDS.find((f) => f.key === k) || { label: k }).label;
const isMissing = (l, k) => l[k] === null || l[k] === undefined || String(l[k]).trim() === '';
const shownValue = (f, l) => ({ int: () => portions(l[f.key]), price: () => rupees(l[f.key]), datetime: () => `${fmtWhen(l[f.key])} IST` }[f.type] || (() => l[f.key]))();
const inputValue = (f, l) => (isMissing(l, f.key) ? '' : f.type === 'price' ? String(l.price_paise / 100) : f.type === 'datetime' ? toLocalInput(l.pickup_at) : String(l[f.key]));
function parseInput(f, raw) {
  if (f.type === 'int') { const n = parseInt(raw, 10); return Number.isFinite(n) ? n : NaN; }
  if (f.type === 'price') { const n = parseFloat(raw); return Number.isFinite(n) ? Math.round(n * 100) : NaN; }
  if (f.type === 'datetime') return raw ? `${raw}:00+05:30` : null;
  return raw.trim() || null;
}
const NEEDS_TEXT = {
  no_day: "We couldn't tell which day. Choose a date and time.", no_time: "We couldn't find a pickup time.", ambiguous_time: 'Is that AM or PM? Choose the time.',
  past: 'That time has already passed. Choose a new one.', missing: '',
};

async function sellDashboard() {
  const { listings } = await api('GET', '/api/my-listings');
  const active = listings.filter((l) => ['draft', 'available', 'sold_out'].includes(l.display_status));
  const past = listings.filter((l) => !['draft', 'available', 'sold_out'].includes(l.display_status));
  const list = state.sTab === 'active' ? active : past;
  const card = (l) => l.display_status === 'draft'
    ? `<div class="card pad14 dashed col gap10"><div class="row between" style="align-items:flex-start;gap:8px"><div class="col"><div class="title">${esc(l.title)}</div><div class="small">Not visible to neighbours yet</div></div>${statusChip(l)}</div>
        <div class="row between gap10"><div class="small" style="line-height:18px">Finish it to publish</div><a class="btn sm outline" href="#/sell/review/${esc(l.id)}">Continue</a></div></div>`
    : `<a class="card pad14 col gap10" href="#/sell/manage/${esc(l.id)}"><div class="row between" style="align-items:flex-start;gap:8px"><div class="col"><div class="title">${esc(l.title)}</div><div class="small">${esc(fmtWhen(l.pickup_at))} · ${esc(l.pickup_location)}</div></div>${statusChip(l)}</div>
        <div class="progress" aria-hidden="true"><div style="width:${Math.round((l.booked_quantity / l.total_quantity) * 100)}%"></div></div>
        <div class="row between" style="font-size:13.5px"><b>${l.booked_quantity} of ${l.total_quantity} portions booked</b><span class="small">${l.available_quantity ? `${l.available_quantity} left` : 'Fully booked'}</span></div></a>`;
  return {
    html: `<div class="page-head row"><h1 class="h1">My listings</h1><a class="btn sm" href="#/sell/new" style="border-radius:999px">${svg('plus', 18, 2.4)}&nbsp;New listing</a></div>
      <div class="seg"><button class="${state.sTab === 'active' ? 'on' : ''}" data-action="tab" data-k="active">Active</button><button class="${state.sTab === 'past' ? 'on' : ''}" data-action="tab" data-k="past">Past</button></div>
      <div class="stack" style="flex:1">${list.length ? list.map(card).join('') : `<div class="empty"><p>${state.sTab === 'active' ? "You haven't listed anything yet." : 'No past listings.'}</p>${state.sTab === 'active' ? '<a class="btn sm" href="#/sell/new">Create your first listing</a>' : ''}</div>`}</div>`,
    bind: (root) => on(root, 'tab', (el) => { state.sTab = el.dataset.k; route(); }),
  };
}

async function sellCreate() {
  const describe = state.createTab === 'describe';
  const tomorrow = toLocalInput(Date.now() + 864e5).slice(0, 10) + 'T18:00';
  return {
    html: `<div class="topbar" style="justify-content:space-between"><a class="iconbtn" href="#/sell" aria-label="Close">${svg('close', 22, 2)}</a><b style="font-size:16px">New listing</b><span style="width:44px"></span></div>
      <div class="seg" style="margin-bottom:18px"><button class="${describe ? 'on' : ''}" data-action="ctab" data-k="describe">Describe it</button><button class="${describe ? '' : 'on'}" data-action="ctab" data-k="form">Use a form</button></div>
      ${describe ? `<div class="pad col gap16 grow">
          <div class="col gap8"><label class="h2" style="font-size:20px" for="offer">Tell us what you're making</label><p class="small" style="font-size:14px;line-height:20px">Write it the way you'd post it in the group chat. We'll turn it into a draft.</p>
            <textarea id="offer" class="field focus" rows="5" placeholder="Home-cooked pasta for 6 people, pickup at the clubhouse at 6 PM tomorrow, ₹150 per portion."></textarea></div>
          <div class="col gap10" style="padding:14px;border-radius:14px;background:var(--soft)"><b style="font-size:13.5px">Good offers mention</b>
            <div class="checklist">${['What you\'re cooking', 'How many portions', 'Pickup day and time', 'Pickup spot', 'Price per portion'].map((t) => `<div>${svg('check', 18, 2.2)}${t}</div>`).join('')}</div></div></div>
        <div class="footer"><button class="btn" id="go">Create draft</button><div class="note">Nothing goes live until you review and confirm it.</div></div>`
      : `<div class="pad col gap12 grow" style="padding-bottom:16px">
          <div><label class="lab" for="f-title">Dish</label><input id="f-title" class="field" type="text" placeholder="e.g. Creamy pasta Alfredo"></div>
          <div><label class="lab" for="f-desc">Description</label><textarea id="f-desc" class="field" rows="3" placeholder="What's in it? Veg or non-veg?"></textarea></div>
          <div class="row gap12"><div class="grow"><label class="lab" for="f-qty">Portions</label><input id="f-qty" class="field" type="number" min="1" inputmode="numeric"></div>
            <div class="grow"><label class="lab" for="f-price">Price per portion (₹)</label><input id="f-price" class="field" type="number" min="0" step="any" inputmode="decimal"></div></div>
          <div><label class="lab" for="f-when">Pickup date and time (IST)</label><input id="f-when" class="field" type="datetime-local" value="${tomorrow}"></div>
          <div><label class="lab" for="f-where">Pickup spot</label><input id="f-where" class="field" type="text" placeholder="e.g. Clubhouse"></div></div>
        <div class="footer"><button class="btn" id="go">Create draft</button><div class="note">Nothing goes live until you review and confirm it.</div></div>`}`,
    bind: (root) => {
      on(root, 'ctab', (el) => { state.createTab = el.dataset.k; route(); });
      $('#go', root).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
          if (describe) {
            const r = await api('POST', '/api/drafts/extract', { text: $('#offer', root).value });
            state.notes[r.id] = r.notes; location.hash = `#/sell/review/${r.id}`;
          } else {
            const num = (id) => { const v = $(id, root).value; return v === '' ? undefined : Number(v); };
            const price = num('#f-price'); const when = $('#f-when', root).value;
            const fields = { title: $('#f-title', root).value, description: $('#f-desc', root).value, total_quantity: num('#f-qty'),
              price_paise: price === undefined ? undefined : Math.round(price * 100), pickup_at: when ? `${when}:00+05:30` : undefined, pickup_location: $('#f-where', root).value };
            if (!fields.title.trim()) { toast('Add a name for your dish.'); ev.target.disabled = false; return; }
            const r = await api('POST', '/api/drafts', { fields });
            state.notes[r.id] = { confirm: [], needs: [] }; location.hash = `#/sell/review/${r.id}`;
          }
        } catch (e) { toast(errorText(e)); ev.target.disabled = false; }
      });
    },
  };
}

async function sellReview(id) {
  const { listing: l } = await api('GET', `/api/my-listings/${id}`);
  if (l.status === 'closed') { location.hash = '#/sell'; return null; }
  const isDraft = l.status === 'draft';
  const frozen = !isDraft && l.booked_quantity > 0 ? new Set(['title', 'price_paise', 'pickup_at', 'pickup_location']) : new Set();
  const notes = state.notes[id] || { confirm: [], needs: [] };
  const needText = (k) => { const n = notes.needs.find((x) => x.field === k); return n && NEEDS_TEXT[n.reason] ? `<p class="small" style="color:#7A4A00">${NEEDS_TEXT[n.reason]}</p>` : ''; };
  const pendingConfirm = (k) => isDraft && notes.confirm.find((c) => c.field === k) && !state.ack[`${id}:${k}`];
  const editorFor = (f) => {
    const v = esc(inputValue(f, l)); const need = isMissing(l, f.key); const cls = `field ${need ? 'need' : 'focus'}`; const eid = `ed-${f.key}`;
    const input = f.type === 'textarea' ? `<textarea id="${eid}" class="${cls}" rows="3" placeholder="${esc(f.ph || '')}">${v}</textarea>`
      : f.type === 'datetime' ? `<input id="${eid}" class="${cls}" type="datetime-local" value="${v}">`
      : f.type === 'int' || f.type === 'price' ? `<input id="${eid}" class="${cls}" type="number" inputmode="decimal" min="${f.type === 'int' ? 1 : 0}" step="${f.type === 'int' ? 1 : 'any'}" value="${v}">`
      : `<input id="${eid}" class="${cls}" type="text" value="${v}">`;
    return `${input}<div class="row gap8"><button class="btn sm" data-action="save" data-key="${f.key}">Save</button>${need ? '' : '<button class="btn sm neutral" data-action="stop">Cancel</button>'}</div>`;
  };
  const rowFor = (f) => {
    const need = isMissing(l, f.key); const editing = ui.editing === f.key;
    const head = (chip) => `<div class="row between"><label class="k" for="ed-${f.key}">${f.label}</label>${chip}</div>`;
    if (need) return `<div class="r need">${head('<span class="chip warn">Needed</span>')}${editorFor(f)}${needText(f.key)}</div>`;
    if (editing) return `<div class="r edit">${head('')}${editorFor(f)}</div>`;
    if (pendingConfirm(f.key)) {
      const c = notes.confirm.find((x) => x.field === f.key);
      const q = c.reason === 'people' ? `You wrote "${esc(c.text)}". Should buyers book ${l.total_quantity} ${l.total_quantity === 1 ? 'portion' : 'portions'}, one per person?` : `You wrote "${esc(c.text)}" with no unit. Is ${rupees(l.price_paise)} the price for one portion?`;
      return `<div class="r need"><div class="row between"><span class="k">${f.label}</span><span class="chip warn">Please confirm</span></div><div class="v">${esc(shownValue(f, l))}</div>
        <p style="font-size:13.5px;line-height:19px;color:#2B3A34">${q}</p>
        <div class="row gap8"><button class="btn sm" data-action="ack" data-key="${f.key}">${c.reason === 'people' ? `Yes, ${portions(l.total_quantity)}` : 'Yes, per portion'}</button><button class="btn sm neutral" data-action="edit" data-key="${f.key}">Change</button></div></div>`;
    }
    const right = frozen.has(f.key) ? `<span class="iconbtn ghost" style="color:var(--muted)" role="img" aria-label="Locked after the first booking" title="Locked after the first booking">${svg('lock', 18)}</span>`
      : `<button class="iconbtn ghost" data-action="edit" data-key="${f.key}" aria-label="Edit ${f.label}">${svg('pencil', 20)}</button>`;
    return `<div class="r"><div class="col"><span class="k">${f.label}</span><span class="v">${esc(shownValue(f, l))}</span>${f.key === 'pickup_at' && notes.confirm.length && isDraft ? '' : ''}</div>${right}</div>`;
  };
  const missing = FIELDS.filter((f) => isMissing(l, f.key)).map((f) => f.label.toLowerCase());
  const unconfirmed = FIELDS.filter((f) => !isMissing(l, f.key) && pendingConfirm(f.key)).map((f) => f.label.toLowerCase());
  const todo = [...missing, ...unconfirmed];
  return {
    html: `<div class="topbar"><a class="iconbtn" href="${isDraft ? '#/sell' : `#/sell/manage/${esc(id)}`}" aria-label="Back">${svg('back', 22, 2)}</a><h1 class="h2" style="font-size:20px">${isDraft ? 'Review your listing' : 'Edit listing'}</h1></div>
      <div class="stack" style="flex:1">
        ${isDraft ? banner('ok', 'info', 'We filled this in from what you wrote. Check each detail. Nothing goes live until you publish.') : (frozen.size ? banner('warn', 'lock', 'Someone has booked, so the dish, price, pickup time and spot are locked. You can still change the description and portions.') : '')}
        <div class="rows">${FIELDS.map(rowFor).join('')}</div>
        ${isDraft ? '<button class="btn sm danger-outline" data-action="discard" style="align-self:flex-start">Discard draft</button>' : ''}</div>
      ${isDraft ? `<div class="footer"><button class="btn" id="publish" ${todo.length ? 'disabled' : ''}>Publish listing</button>
        <div class="note">${todo.length ? `${todo.length} ${todo.length === 1 ? 'thing' : 'things'} to sort first: ${esc(todo.join(', '))}.` : 'Neighbours will see this right away.'}</div></div>`
        : `<div class="footer"><a class="btn" href="#/sell/manage/${esc(id)}">Done</a></div>`}`,
    bind: (root) => {
      on(root, 'edit', (el) => { ui.editing = el.dataset.key; route(); });
      on(root, 'stop', () => { ui.editing = null; route(); });
      on(root, 'ack', (el) => { state.ack[`${id}:${el.dataset.key}`] = true; route(); });
      on(root, 'save', async (el) => {
        const f = FIELDS.find((x) => x.key === el.dataset.key);
        const val = parseInput(f, $(`#ed-${f.key}`, root).value);
        if (Number.isNaN(val)) { toast('Enter a number.'); return; }
        el.disabled = true;
        try { await api('PATCH', `/api/listings/${id}`, { [f.key]: val }); state.ack[`${id}:${f.key}`] = true; ui.editing = null; }
        catch (e) { toast(errorText(e)); }
        route();
      });
      on(root, 'discard', async () => { try { await api('DELETE', `/api/drafts/${id}`); location.hash = '#/sell'; } catch (e) { toast(errorText(e)); } });
      const pub = $('#publish', root);
      if (pub) pub.addEventListener('click', async () => {
        pub.disabled = true;
        try { await api('POST', `/api/listings/${id}/publish`); toast('Your listing is live.'); location.hash = '#/sell'; }
        catch (e) { toast(errorText(e)); route(); }
      });
    },
  };
}

async function sellManage(id) {
  const { listing: l, bookings: bs } = await api('GET', `/api/my-listings/${id}`);
  if (l.status === 'draft') { location.hash = `#/sell/review/${id}`; return null; }
  const live = l.display_status === 'available' || l.display_status === 'sold_out';
  const active = bs.filter((b) => b.status === 'confirmed');
  const bookingRow = (b) => `<div class="r" style="${b.status === 'cancelled' ? 'background:#F8FAF9' : ''}"><div class="col" style="padding:4px 0"><b style="font-size:15px;${b.status === 'cancelled' ? 'color:var(--muted)' : ''}">${esc(b.buyer_name)} · ${esc(b.buyer_flat)}</b>
      <span class="small">${b.status === 'cancelled' ? `${portions(b.quantity)} returned` : `${portions(b.quantity)} · ${rupees(b.quantity * l.price_paise)}`} · ${esc(fmtTime(b.created_at))}</span></div>
      <span class="chip ${b.status === 'cancelled' ? 'grey' : 'ok'}" style="margin-right:8px">${b.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</span></div>`;
  return {
    html: `<div class="topbar"><a class="iconbtn" href="#/sell" aria-label="Back to my listings">${svg('back', 22, 2)}</a><b style="font-size:16px">Manage listing</b></div>
      <div class="stack" style="gap:16px;flex:1">
        <div class="row between" style="align-items:flex-start;gap:8px"><div class="col gap4"><h1 class="h1" style="font-size:24px;line-height:30px">${esc(l.title)}</h1><span class="small">${esc(fmtWhen(l.pickup_at))} · ${esc(l.pickup_location)}</span></div><span style="margin-top:4px">${statusChip(l)}</span></div>
        ${live ? `<div class="card pad14 col gap12"><div class="row between"><div class="col"><b style="font-size:15px">Total portions</b><span class="small" id="sub">${l.booked_quantity} booked · ${l.available_quantity} left</span></div>
            <div class="stepper"><button class="iconbtn" id="dec" aria-label="One fewer portion">${svg('minus', 20, 2)}</button><div class="num" id="qty" aria-live="polite">${l.total_quantity}</div><button class="iconbtn" id="inc" aria-label="One more portion">${svg('plus', 20, 2)}</button></div></div>
          <div id="err" hidden>${banner('danger', 'info', `You can't go below ${l.booked_quantity}. ${portions(l.booked_quantity)} already booked.`)}</div>
          <button class="btn" id="save" disabled>Save changes</button></div>` : ''}
        <div class="col gap8"><b style="font-size:15px;font-weight:800">Bookings</b>
          ${bs.length ? `<div class="rows">${bs.map(bookingRow).join('')}</div>` : '<p class="small">No bookings yet.</p>'}</div></div>
      ${live ? `<div class="footer row2"><a class="btn outline" href="#/sell/review/${esc(id)}" style="flex:1">Edit details</a><button class="btn danger-outline" id="close" style="flex:1">Close listing</button></div>` : ''}`,
    bind: (root) => {
      if (!live) return;
      let q = l.total_quantity; const booked = l.booked_quantity;
      const paint = () => {
        const bad = q < booked; const qty = $('#qty', root);
        qty.textContent = q; qty.classList.toggle('bad', bad);
        $('#err', root).hidden = !bad; $('#dec', root).disabled = q <= 1;
        $('#save', root).disabled = bad || q === l.total_quantity;
        $('#sub', root).textContent = bad ? `${booked} booked` : `${booked} booked · ${q - booked} left`;
      };
      $('#dec', root).addEventListener('click', () => { q = Math.max(1, q - 1); paint(); });
      $('#inc', root).addEventListener('click', () => { q += 1; paint(); });
      $('#save', root).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try { await api('PATCH', `/api/listings/${id}`, { total_quantity: q }); toast('Saved.'); } catch (e) { toast(errorText(e)); }
        route();
      });
      $('#close', root).addEventListener('click', () => {
        const people = active.length; const ports = active.reduce((s, b) => s + b.quantity, 0);
        $('#overlay').innerHTML = `<div class="sheet-wrap"><div class="sheet" role="dialog" aria-modal="true" aria-label="Close this listing"><div class="grab"></div>
          <div class="col gap6"><h2 class="h2">Close this listing?</h2><p class="sub" style="font-size:14.5px;line-height:21px">${people ? `${people} ${people === 1 ? 'booking' : 'bookings'} (${portions(ports)}) will be cancelled and the ${people === 1 ? 'buyer' : 'buyers'} told. This can't be undone.` : 'No one has booked yet. Neighbours will stop seeing it.'}</p></div>
          <div class="col gap10"><button class="btn danger" id="yes">Yes, close listing</button><button class="btn neutral" id="no">Keep it open</button></div></div></div>`;
        $('#no').focus(); $('#no').addEventListener('click', closeOverlay);
        $('#yes').addEventListener('click', async (ev) => {
          ev.target.disabled = true;
          try { const r = await api('POST', `/api/listings/${id}/close`); closeOverlay(); toast(r.cancelled_bookings ? `Listing closed. ${r.cancelled_bookings} ${r.cancelled_bookings === 1 ? 'buyer' : 'buyers'} told.` : 'Listing closed.'); location.hash = '#/sell'; }
          catch (e) { closeOverlay(); toast(errorText(e)); route(); }
        });
      });
      paint();
    },
  };
}

async function alerts() {
  const { notifications: ns } = await api('GET', '/api/notifications');
  const meta = { booking_received: ['bag', ''], listing_sold_out: ['seal', 'solid'], booking_confirmed: ['receipt', 'amber'], listing_closed: ['warn', 'amber'] };
  const href = (n) => ({ booking_received: `#/sell/manage/${n.listing_id}`, listing_sold_out: `#/sell/manage/${n.listing_id}`, booking_confirmed: '#/bookings', listing_closed: '#/' }[n.type] || '#/');
  const item = (n) => { const [ic, cls] = meta[n.type] || ['bell', '']; const unread = !n.read_at;
    return `<a class="notif ${unread ? 'unread' : ''}" href="${href(n)}"><div class="ic ${cls}">${svg(ic, 22)}</div><div class="grow col gap4"><b style="font-size:15px;line-height:21px;font-weight:${unread ? 800 : 700}">${esc(n.title)}</b>
      <span style="font-size:13.5px;line-height:19px;color:#3F4C47">${esc(n.body)}</span><span class="small" style="font-size:12.5px">${esc(dayLabel(n.created_at))} · ${esc(fmtTime(n.created_at))}</span></div>${unread ? '<span class="dot" role="img" aria-label="Unread"></span>' : ''}</a>`; };
  return {
    html: `<div class="page-head"><h1 class="h1">Alerts</h1></div>
      <div style="flex:1">${ns.length ? ns.map(item).join('') : '<div class="empty"><p>No alerts yet. Bookings and updates show up here.</p></div>'}<div style="border-top:1px solid var(--line)"></div></div>`,
    bind: () => { if (ns.some((n) => !n.read_at)) api('POST', '/api/notifications/read').then(() => { state.unread = 0; renderNav('alerts'); }).catch(() => {}); },
  };
}

// ---------- router + nav ----------
const ROUTES = [
  { re: /^#\/?$/, fn: browse, nav: 'browse' },
  { re: /^#\/login$/, fn: login },
  { re: /^#\/join$/, fn: join },
  { re: /^#\/account$/, fn: account },
  { re: /^#\/listing\/([\w-]+)$/, fn: listing },
  { re: /^#\/booked$/, fn: booked },
  { re: /^#\/conflict$/, fn: conflict },
  { re: /^#\/bookings$/, fn: bookings, nav: 'bookings' },
  { re: /^#\/sell$/, fn: sellDashboard, nav: 'sell' },
  { re: /^#\/sell\/new$/, fn: sellCreate },
  { re: /^#\/sell\/review\/([\w-]+)$/, fn: sellReview },
  { re: /^#\/sell\/manage\/([\w-]+)$/, fn: sellManage },
  { re: /^#\/alerts$/, fn: alerts, nav: 'alerts' },
];
const NAV = [['browse', '#/', 'home', 'Browse'], ['bookings', '#/bookings', 'receipt', 'Bookings'], ['sell', '#/sell', 'addcircle', 'Sell'], ['alerts', '#/alerts', 'bell', 'Alerts']];
function renderNav(active) {
  const nav = $('#nav');
  if (!active) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.hidden = false;
  nav.innerHTML = NAV.map(([k, href, ic, label]) => `<a href="${href}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${svg(ic, 24)}${label}${k === 'alerts' && state.unread ? `<span class="badge" aria-label="${state.unread} unread">${state.unread}</span>` : ''}</a>`).join('');
}
async function refreshMe() {
  try {
    const r = await api('GET', '/api/me');
    state.account = r.account; state.me = r.me; state.unread = r.unread;
  } catch (e) { if (e.status === 401) { state.account = null; state.me = null; } else throw e; }
}

let routeToken = 0;
async function route() {
  const token = ++routeToken; const hash = location.hash || '#/';
  clearInterval(ui.timer); ui = { step: ui.step }; closeOverlay();
  const screen = $('#screen');
  try {
    if (!state.account) await refreshMe();
    if (token !== routeToken) return;
    if (!state.account) { if (hash !== '#/login') { location.hash = '#/login'; return; } }
    else if (!state.me) { if (hash !== '#/join') { location.hash = '#/join'; return; } }
    else if (hash === '#/join' || hash === '#/login') { location.hash = '#/'; return; }
  } catch (e) { screen.innerHTML = `<div class="empty"><p>${esc(errorText(e))}</p><button class="btn sm" id="retry">Try again</button></div>`; $('#retry')?.addEventListener('click', route); return; }
  const hit = ROUTES.find((r) => r.re.test(hash));
  if (!hit) { location.hash = '#/'; return; }
  screen.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const [out] = await Promise.all([hit.fn(...hash.match(hit.re).slice(1)), state.me ? refreshMe() : null]);
    if (token !== routeToken || !out) return;
    if (state.me === null && state.account && hash !== '#/join') { location.hash = '#/join'; return; }
    screen.innerHTML = out.html; screen.scrollTop = 0;
    renderNav(hit.nav);
    document.title = `${(screen.querySelector('h1')?.textContent || 'Society Kitchen').trim()} · Society Kitchen`;
    out.bind?.(screen);
  } catch (e) {
    if (token !== routeToken) return;
    if (e.status === 401) { state.account = null; state.me = null; location.hash = '#/login'; route(); return; }
    screen.innerHTML = `<div class="empty"><p>${esc(errorText(e))}</p><button class="btn sm" id="retry">Try again</button><a class="btn sm outline" href="#/">Home</a></div>`;
    renderNav(null); $('#retry')?.addEventListener('click', route);
  }
}
window.addEventListener('hashchange', route);
(async () => {
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) { store.set('invite', joinCode.slice(0, 40)); history.replaceState(null, '', location.pathname + location.hash); }
  try { state.authMode = (await api('GET', '/api/config')).authMode; } catch {}
  route();
})();
