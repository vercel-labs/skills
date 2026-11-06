# Society Kitchen

A simple marketplace for residents to offer and book home-cooked food inside their residential society. Payment is settled offline.

- `supabase/migrations/`: database schema, the booking/cancel/edit functions that hold every rule, and row-level security
- `server/`: small Node server (no dependencies): the JSON API and the web app host
- `app/`: the mobile-first web app (11 screens, no build step)
- `tests/`: backend rules, the plain-language extractor, and browser end-to-end tests
- `docs/PLAN.md`: decisions and design notes

## Run it on your computer

You need Node 22+ and PostgreSQL 14+ (with `psql`). No `npm install` is needed.

```bash
# 1. Create a demo database (WARNING: drops and recreates it)
ADMIN_URL=postgres://YOUR_USER@127.0.0.1:5432/postgres DB=society_kitchen scripts/setup.sh

# 2. Start the app (demo mode: pick any resident, no password)
AUTH_MODE=dev DATABASE_URL=postgres://YOUR_USER@127.0.0.1:5432/society_kitchen node server/server.mjs
#    Real sign-in locally: omit AUTH_MODE, then open http://localhost:4173/?join=MAPLE-123 (demo society code).

# 3. Open http://localhost:4173 on your computer, or on your phone on the same Wi-Fi
#    (use your computer's address instead of localhost)
```

`YOUR_USER` must be a Postgres superuser for the demo. In dev mode pick a resident on the sign-in screen. Try two browsers as two residents to see the "someone booked first" case.

## Put it online and invite your society

See [docs/DEPLOY.md](docs/DEPLOY.md): free hosting (Neon + Render), the invite link, and installing on phones.

## Sign-in

The default (`AUTH_MODE=link`) needs no SMS: neighbours open your society's invite link, enter name, flat and a 6-digit PIN, and can sign back in on a new phone with the same details. Anyone with the link can join, so treat the invite code like a shared password. `AUTH_MODE=otp` (below) adds phone verification once you have an SMS gateway; `AUTH_MODE=dev` is for demos only.

### Phone number + code (AUTH_MODE=otp)

Default mode (`AUTH_MODE=otp`): enter a mobile number, get a 6-digit code by SMS, then (first time only) enter your society's invite code, name and flat. A cookie keeps you signed in for 30 days; Log out ends it on the server.

| Variable | Meaning |
|---|---|
| `AUTH_SECRET` | Required. 16+ random characters; keys the code hashing. |
| `OTP_PROVIDER` | `webhook` (production) or `console` (needs `ALLOW_CONSOLE_OTP=1`; prints codes in the log). |
| `OTP_WEBHOOK_URL` | Receives `POST {"phone","message"}`. Point it at your SMS gateway or a small function that calls it. |
| `COOKIE_SECURE=1` | Set when served over HTTPS (always, in production). |
| `TRUST_PROXY=1` | Set only behind a reverse proxy you control, so per-IP limits use the real client address. |

Rules: codes last 10 minutes and work once; 5 wrong tries kill a code; 30 seconds between codes and 5 per hour per number; per-IP cap; codes and session tokens are stored only as hashes. Changing requests need an `x-sk: 1` header (blocks cross-site form posts). Rate limits are in memory, so run one server process, or move them to a shared store first.

## Tests

```bash
npm test                                  # database rules + extractor (needs a superuser DATABASE_URL, see tests/booking.test.mjs)
ADMIN_URL=postgres://... npm run test:e2e # browser tests; needs Playwright installed globally
```

## Not built yet

- Push notifications. Alerts appear in the app only.
- Plain-language extraction is rule-based. It handles the common phrasings and asks about anything unclear, but a Claude-powered version would understand more.
- Phone verification in the default mode. The SMS version is built (`AUTH_MODE=otp`) but needs a paid gateway.
- PIN reset for forgotten PINs (a database admin can do it; see docs/DEPLOY.md).
- Offline use. The installed app still needs an internet connection.
