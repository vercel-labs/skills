# Put Society Kitchen online (free) and invite your society

You need about 30 minutes and two free accounts: **Neon** (the database) and **Render** (runs the app). Neither needs a card for the free plan at the time of writing; check their pricing pages.

Free-plan trade-offs: Render's free app goes to sleep after ~15 minutes of no visits, so the first open after a quiet spell takes up to a minute. Neon's free database also sleeps and wakes on use. Fine for a society trial; upgrade later if it gets busy.

## 1. Database (Neon)

1. Sign up at neon.com, create a project (pick the region nearest you, e.g. Mumbai if offered).
2. Open **SQL Editor**. Paste the whole of `deploy/setup.sql` and run it once. It should finish with no errors.
3. Run this in the same editor, with **your** society name and a **hard-to-guess** invite code (it is the only thing keeping outsiders out; at least 8 characters, e.g. `HARMONY-7QX4K`):
   ```sql
   insert into societies (name, invite_code) values ('Harmony Residency', 'HARMONY-7QX4K');
   ```
4. On the project dashboard click **Connect** and copy the connection string (starts with `postgres://`). Keep it private: it is a password.

## 2. The app (Render)

1. Sign up at render.com with GitHub. **New > Web Service** and pick the repo that holds this code (merge the `society-kitchen` branch to `main` first, or choose that branch).
2. Settings:
   - Root Directory: `projects/society-kitchen` (leave empty if the app is at the repo root)
   - Runtime: Node. Build command: `npm install --omit=dev`. Start command: `node server/server.mjs`
   - Health check path: `/api/health`
3. Environment variables:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `AUTH_MODE` | `link` |
   | `COOKIE_SECURE` | `1` |
   | `TRUST_PROXY` | `1` |
   | `NODE_VERSION` | `22` |

4. Deploy. When it finishes you get an address like `https://society-kitchen-xxxx.onrender.com`. Open it: you should see the sign-up screen.

## 3. Invite the society

Your invite link is the app address plus `/?join=` and your code:

`https://society-kitchen-xxxx.onrender.com/?join=HARMONY-7QX4K`

Post it in the society WhatsApp group. Each neighbour opens it, enters their name, flat and a 6-digit PIN, and is in. Later, anyone signed in can press **Share invite link** on the Account screen.

## 4. Put it on the phone

- **Android (Chrome):** open the link, menu (three dots), **Install app** or **Add to Home screen**.
- **iPhone (Safari):** open the link, Share button, **Add to Home Screen**.

It then opens full screen with its own icon.

## Safety notes

- **Anyone with the link can join.** If it leaks outside the society, change the code in the Neon SQL editor, then share the new link:
  `update societies set invite_code = 'NEW-CODE-123' where invite_code = 'HARMONY-7QX4K';`
  People already signed in stay signed in.
- **Forgotten PIN:** a neighbour who forgets their PIN can't recover it themselves yet. You (the admin) can set a new one from any computer with Node 22: `DATABASE_URL='...' node scripts/reset-pin.mjs HARMONY-7QX4K "Meera Iyer" B-402 123456`, then tell them the new PIN privately.
- **Nobody is verified.** The app trusts that a neighbour is who they say. Fine for a group that knows each other; add phone verification (the SMS sign-in is already built: `AUTH_MODE=otp`) if that stops being true.
- Keep the Neon connection string out of chat groups and screenshots. Never use `AUTH_MODE=dev` on the internet.
- Money is settled offline, outside the app, as designed.
