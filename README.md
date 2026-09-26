# Trade Desk — self-hosted (no Supabase)

Same dashboard, but auth and storage are now entirely yours: an Express server with
its own email/password login (bcrypt + a JWT cookie) and a Postgres database, both
running under your own Railway project. Nothing talks to a third-party backend.

## What changed from the Supabase version
- Sign-up/login is handled by `server.js`, not a third-party auth service. Passwords
  are hashed with bcrypt; sessions are a signed, httpOnly JWT cookie.
- Trades are stored in your own Postgres database instead of a Supabase project.
- The schema (`users`, `trades` tables) is created automatically the first time the
  server boots — `schema.sql` is there for reference, not a required manual step.
- Every request checks the JWT cookie server-side, so a user only ever sees their
  own trades — the same guarantee Supabase's row-level security gave you, just
  enforced in `server.js` instead.

## 1. Deploy on Railway
1. Push this folder to a GitHub repo (`server.js`, `package.json`, `schema.sql`, `public/`).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
3. In the same project, click **New → Database → Add PostgreSQL**. Railway spins up a Postgres instance.
4. Open your app's service → **Variables** tab → **New Variable → Add Reference** → point it at the Postgres plugin's `DATABASE_URL`. This wires the two together without copying a connection string by hand.
5. Add two more variables on the app service:
   - `JWT_SECRET` — any long random string (e.g. run `openssl rand -hex 32` locally and paste the output)
   - `NODE_ENV` = `production`
6. Service → **Settings → Networking → Generate Domain**. You'll have a live `https://…up.railway.app` URL within seconds.

That's it — no manual database setup. The server creates its own tables on first boot.

## 2. Get trade data in
Same as before: export your Deriv trade history (Reports → Statement → Export as CSV),
then use **Import CSV** in the portal to map columns and load it in.

## Local testing
You'll need a local Postgres, or you can point `DATABASE_URL` at the Railway Postgres
instance (its **public** connection string, found in the Postgres plugin's Variables tab)
while testing from your machine:
```
npm install
DATABASE_URL=postgres://... JWT_SECRET=devsecret npm start
```
Then open `http://localhost:3000`. (`NODE_ENV` isn't set locally, so the auth cookie
works over plain http for testing.)

## Notes / trade-offs versus the Supabase version
- No hosted auth dashboard, password-reset emails, or magic links — those would need
  to be added (e.g. with a transactional email provider) if you want them later.
- Logging out clears the cookie but the JWT itself stays valid until it expires (30
  days) if someone captured it — fine for a personal analytics tool, worth knowing
  if you'll ever share this more widely.
- Everything — auth, data, hosting — now lives in one Railway project, so there's
  only one dashboard to manage instead of two.
