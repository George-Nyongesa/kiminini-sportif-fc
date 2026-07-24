# Kiminini Sportif FC — Club Platform

A server-side rendered Express/EJS/PostgreSQL baseline for a local football club: fixtures, live matchday ticker, RBAC membership tiers, M-Pesa dues collection, and printable financial reports.

## Stack
Node.js · Express (MVC) · EJS + express-ejs-layouts · PostgreSQL (raw SQL via `pg`) · Passport.js (Local, Google, Facebook) · express-session + connect-pg-simple

## Folder structure
```
config/       db.js (pg pool), passport.js (strategies + serialization)
middleware/   auth.js (requireAuth, requireRole, requireActiveMembership)
routes/       index.js (public), auth.js, matches.js (matchday API), payments.js (M-Pesa), dashboard.js
db/           schema.sql (tables, enums, indexes, triggers, session store)
views/        layouts/, partials/, and page templates (EJS)
public/       css/style.css, js/ticker.js, images/
server.js     app bootstrap
```

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in your PostgreSQL role, session secret, and OAuth/M-Pesa credentials (dummy values are fine for local dev — OAuth buttons just won't complete without real keys, and the M-Pesa STK push is stubbed in `routes/payments.js` until you wire in real Daraja credentials).
3. Create the database: `createdb kiminini_sportif_fc` (or via `psql`, using your existing PostgreSQL role).
4. Load the schema: `npm run db:init` (runs `db/schema.sql`, which also creates the `session` table used by `connect-pg-simple`).
5. `npm run dev` (or `npm start`) and visit `http://localhost:3000`.

## Roles & access
`fan` → `player` / `coach` / `tm` (require `is_membership_active`) → `treasurer` → `admin` (bypasses all role checks). Enforced via `middleware/auth.js`. Registering as a paid-tier role redirects straight to `/pay-dues`.

## Key endpoints
- `POST /api/matches/:id/lineup` — single-tap lineup board update (Coach/TM/Admin)
- `POST /api/matches/:id/event` — logs a match event and auto-increments the scoreboard on goals (Coach/TM/Admin)
- `GET /api/matches/:id/ticker` — polled every 15s by `public/js/ticker.js` to refresh the homepage live feed
- `POST /api/payments/stk-push` — triggers the M-Pesa payment prompt (stubbed `initiateStkPush()` — replace with a real Daraja call)
- `POST /api/payments/callback` — Daraja webhook; sets `is_membership_active = TRUE` on success
- `GET /reports/financial` — Treasurer-only printable A4 report (`@media print` rules in `style.css`)

## Design system
Palette locked to the brief: emerald (`#065f46` / `#10b981`), gold (`#f59e0b`), deep slate (`#0f172a`), off-white (`#f8fafc`). Display type is Oswald (uppercase, tracked) for headings and scores; body copy is Inter. The homepage's live scoreboard is the signature UI element — a floodlit, stadium-style score display with a pulsing "Live" indicator and a polling event feed.

## Not yet wired (by design, as a baseline)
- Real Daraja OAuth token + STK push request (currently stubbed so the app runs without live Safaricom credentials)
- CMS for club news (the homepage news section is a static placeholder for the admin-authored content the brief calls out)
- A dedicated `lineups` table (the lineup endpoint currently just validates and timestamps; extend `db/schema.sql` if you want per-fixture lineup persistence beyond match events)
