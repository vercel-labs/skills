# Society Kitchen: build plan and decisions

Status: backend booking core and a working web app (all 11 designed screens) are built and tested. Real sign-in (phone + one-time code, cookie sessions) and the invite-code join screen are built and tested; an SMS gateway still has to be plugged in. Push notifications and a Claude-powered extractor are still to build.

## Decisions taken (change any of these and the code is small to adjust)

| Question from the PRD | Decision | Where it lives |
|---|---|---|
| Closing a listing that has bookings | Allowed. All bookings are cancelled and every buyer is notified. Not allowed after pickup time. | `close_listing` |
| Joining a society | Invite code per society. Societies are created by an admin (dashboard / service role). | `join_society` |
| Notification channel | In-app list now (`notifications` table). Push later by a webhook on insert. | `notifications` |
| What "portion" means | One portion = one person's serving. `quantity_unit` column defaults to `portion`. | `listings.quantity_unit` |
| Notify seller when a cancellation frees a portion | No. The listing just shows availability again. | none |

Decisions the PRD did not cover, which I made. Please check them:

1. **After the first booking, price, pickup time, pickup place and title are frozen.** Buyers booked on those terms. The seller can still raise or lower the quantity (never below what is booked) and edit the description.
2. **A seller cannot book their own listing.**
3. **Booking and cancel are the only client actions on bookings.** The seller cannot remove a single booking; closing the listing is the only seller-side cancel.
4. **Repeat cancel is a harmless no-op**, not an error.

## Data model

- `societies` (name, invite_code, timezone)
- `profiles` (user, society, display_name, flat_label)
- `listings` (seller, title, description, total_quantity, **booked_quantity**, price_paise, pickup_at, pickup_location, status: draft | published | closed)
- `bookings` (listing, buyer, quantity, status: confirmed | cancelled, cancel_reason: buyer | seller_closed)
- `notifications` (user, type, title, body, read_at)
- View `listings_with_availability` adds `available_quantity` and `display_status`: draft, available, sold_out, expired, closed. Status comes from the clock, so listings expire and sell out with no background job.

Rules held by the database itself, not only by app code:
- `booked_quantity <= total_quantity` (CHECK). Overbooking is impossible even if a function has a bug.
- A published listing must have every required field (CHECK).
- Money is integer paise. Times are UTC instants; IST is for display. The cutoff is `pickup_at - 1 hour`, an absolute moment, so it is correct in any time zone.

## API (Postgres functions, called as Supabase RPC)

| Function | What it does |
|---|---|
| `join_society(code, name, flat)` | Create your profile in a society |
| `create_listing_draft(fields)` | Save a draft (only the title is required). Used by the form and by the plain-language flow |
| `update_listing(id, changes)` | Edit a draft or live listing, subject to the freeze and quantity rules |
| `publish_listing(id)` | Go live. Fails with the list of missing fields; never guesses |
| `discard_draft(id)` | Delete a draft |
| `book_listing(id, qty)` | Check and reserve capacity atomically (row lock). Notifies seller and buyer; notifies seller when sold out |
| `cancel_booking(id)` | Allowed only strictly before pickup minus 1 hour. Restores quantity once |
| `close_listing(id)` | Seller closes; cancels bookings; notifies buyers |

Reads go through row-level security: you see only your society's listings, drafts only to their seller, bookings only to the buyer and the seller. Clients have no write access to `listings` or `bookings`.

Errors come back as the message text, with JSON in the error detail. The app maps them to screens:

| Code | Detail | Screen |
|---|---|---|
| `insufficient_capacity` | `{available, requested}` | 4 · "Someone booked first" |
| `sold_out` | `{available: 0}` | 4 |
| `cancellation_closed` | `{cutoff}` | 5 · disabled Cancel with the cutoff time |
| `quantity_below_booked` | `{booked, requested}` | 10 · "You can't go below 2" |
| `missing_fields` | `{fields: [...]}` | 8 · flagged fields on the draft |
| `locked_after_booking` | `{fields: [...]}` | 10 |
| `listing_expired`, `listing_closed`, `listing_not_found`, `cannot_book_own_listing` | | listing screens |

## Testing

`npm test` runs 27 tests against a real Postgres (needs a superuser `DATABASE_URL`; defaults to a local test server). They cover every acceptance criterion in the PRD, including:

- 8 buyers racing for the last 2 portions: exactly one wins
- 20 buyers racing for 5 portions: exactly 5 succeed
- 5 simultaneous cancels of one booking: quantity restored once
- Cutoff boundary: allowed 1 microsecond before, blocked exactly at it and after
- RLS: outsiders, drafts, direct writes

I checked the tests are meaningful by deliberately breaking the code four ways (no row lock, no repeat-cancel guard, cutoff off by one, no quantity floor). Each break was caught.

## The app

Built as a mobile-first web app (no framework, no build step) served by a small dependency-free Node server over the tested database functions. I chose this over Expo/React Native because the build sandbox cannot install npm packages, so a native app could not have been run or tested. The database functions do not change if a native app is added later.

Tested in a real browser at phone size: browsing, booking, the "someone booked first" race (both sold-out and partly-available cases), cancelling before the cutoff and being blocked inside the final hour, publishing from plain language and from a form, the quantity floor, closing a listing, alerts and unread badge, and society privacy. 14 browser tests, 35 backend/extractor tests.

Plain-language listing is rule-based for now. It fills in only what the text clearly says (title, portions, price, place, day and time resolved in IST) and flags the rest. "For 6 people" asks to confirm 6 portions; "at 6" with no AM/PM asks; a price with no unit asks; a time already passed is refused. It never publishes.

## Next

1. Choose an SMS gateway and point `OTP_WEBHOOK_URL` at it (sign-in itself is done: see README, tests/auth.test.mjs, tests/e2e-auth.test.mjs).
2. Push notifications on new rows in `notifications`.
3. Claude-powered extraction behind the same response shape as `server/extract.mjs`.
4. Deploy: managed Postgres (Supabase) and a host for the Node server; add the `auth.users` foreign key on `profiles`.
5. Optional: wrap the web app as an installable phone app, or build a native app on the same functions.

## Sign-in decisions

- Phone number + 6-digit code. Codes: HMAC-hashed, 10-minute life, single use (atomic), 5 tries, 30 s gap, 5/hour per number, per-IP cap. Responses never reveal whether a number has an account.
- Sessions: random 256-bit token, stored hashed, revocable, 30 days, HttpOnly + SameSite=Lax cookie (Secure when `COOKIE_SECURE=1`). CSRF: custom `x-sk` header on all non-GET calls.
- `accounts.id` equals `profiles.id`. A signed-in account with no profile is sent to the invite-code screen; invite attempts are limited to 10/hour per account.
- `AUTH_MODE=dev` (pick-a-user, `x-user-id`) exists only for demos/tests; the server refuses to start in otp mode without `AUTH_SECRET`, or with the console provider unless explicitly allowed.

## Link + PIN sign-in (default, no SMS)

Decision: no paid SMS gateway, so "anyone with the link can join" with these safeguards. The invite link carries the society's invite code (unique, case-insensitive, rotated by editing one row). Each resident chooses a 6-digit PIN (scrypt-hashed, salted); 5 wrong PINs lock that account for 15 minutes, counted atomically so parallel guesses can't beat it; per-IP caps; unknown resident and wrong PIN give the same error. Same name + flat (ignoring case, spaces and dashes) cannot register twice within a society. Trade-off accepted: identity is not verified, and a leaked code lets outsiders join until it is changed. The phone-OTP mode stays available behind `AUTH_MODE=otp`.

Also added: installable web app (manifest + icons), `deploy/setup.sql` (one-paste database setup, tested on a non-superuser database like Neon's), `scripts/init-db.sh`, `scripts/create-society.sh`, docs/DEPLOY.md, `pg` driver for hosted databases (the built-in client is used only when `pg` isn't installed, i.e. in tests).
