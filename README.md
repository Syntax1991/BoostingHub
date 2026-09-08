# Boostting Bot

Internal World of Warcraft boosting operations platform for boosters, lootbuddies, raid leads, and administrators.

Boostting Bot is a **web application**. A Discord bot is a later integration, not the product.

This repository is **Phase 3**: foundation, real run signups, and raidlead/admin roster publishing. Existing boosting-community platforms inspired workflow thinking only. Their branding, assets, source, and visual identity are not copied.

## Phase status

- **Phase 1 — Foundation — Complete**
- **Phase 2 — Run Signups — Complete**
- **Phase 3 — Roster Management — Complete**

Phase 1 delivered the application shell, auth, MVCS, and seeded domain models.

Phase 2 makes `/runs` persist BOOSTER and LOOTBUDDY signups, with eligibility from `BoosterAccessService` and `LockoutService`, and self-withdrawal on `/my-runs`.

Phase 3 adds `/manage/runs/[runId]`: persistent draft selection, composition warnings, and transactional roster publication.

Not implemented (intentionally deferred):
- Attendance, payouts, gold ledger
- Battle.net / Blizzard API
- Warcraft Logs API
- Discord bot and notifications
- Customer bookings / boost market
- Priority system and statistics products

## Tech stack

- Next.js 16.3 App Router, React, TypeScript
- Tailwind CSS
- PostgreSQL 15+
- Prisma ORM 8 (contract + `db.orm.public.*`)
- Better Auth (Kysely/pg adapter, same database)
- Zod at controller boundaries
- npm, Node.js 24

Better Auth's Prisma adapter still targets Prisma 7's client API. Phase 1 therefore uses Better Auth's PostgreSQL pool adapter while domain persistence uses Prisma 8. Both share `DATABASE_URL`.

## Architecture

The project follows **MVCS**: Model → View → Controller → Service.

```text
View
  ↓
Controller
  ↓
Service
  ↓
Repository / Model / Database
```

Views never call Prisma. Controllers stay thin. Business rules live in Services.

Client interactivity is isolated: `AppShell`, `Button`, Discord sign-in, run filters, the signup dialog, withdraw, and the roster builder.

See [docs/architecture.md](docs/architecture.md).

## Local development

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Install dependencies: `npm install --legacy-peer-deps`
3. Emit the Prisma contract: `npm run db:emit`
4. Apply migrations: `npm run db:migrate`
5. Seed development data: `npm run db:seed`
6. Start the app: `npm run dev`
7. Open [http://localhost:3000](http://localhost:3000)

If you do not have local PostgreSQL, `npx create-db@latest` can provision a temporary Prisma Postgres database. Claim the printed URL if you need it longer than 24 hours.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Auth secret, ≥32 characters |
| `BETTER_AUTH_URL` | App origin, `http://localhost:3000` locally |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth. Optional until an application exists |
| `DEV_AUTH_ENABLED` | `true` enables the development identity picker. Ignored in production |
| `DEV_AUTH_PASSWORD` | Shared password for seeded credential accounts |

### Discord OAuth

Create an application in the Discord Developer Portal. Redirect URL:

```text
http://localhost:3000/api/auth/callback/discord
```

Until those values are set, Discord login is hidden. Development identities remain available when `DEV_AUTH_ENABLED=true` and `NODE_ENV` is not `production`.

### Development authentication

Seeded identities (password from `DEV_AUTH_PASSWORD`):

- `kael@dev.boostting.local` — USER
- `mira@dev.boostting.local` — USER
- `thorne@dev.boostting.local` — RAID_LEAD
- `aelira@dev.boostting.local` — ADMIN
- `brann@dev.boostting.local` — USER
- `sylva@dev.boostting.local` — USER

This is not a production bypass. See [docs/authentication.md](docs/authentication.md).

### Testing signups with development identities

After `npm run db:seed`, sign in at `/` and use `/runs` → **Sign up**.

- **Kael** — Heroic resto Shaman has a lockout (not eligible). Elemental Shaman is an eligible Heroic DPS. Inactive Ragnaros alt appears under unavailable. Mythic healer access is only pending.
- **Brann** — Two Heroic Paladin offers (tank + holy). Mythic tank access exists but Mythic lockout blocks Mythic loot/boost.
- **Mira** — Lootbuddy examples: loot-only + Access on Wednesday Heroic, playing + Trial on Friday Mythic. Weekend Heroic has a withdrawn lootbuddy row (revive if signed again).
- **Sylva** — Normal Hunter booster; not approved for Heroic.

Withdraw from `/my-runs` when the service allows it. Kael’s selected DPS on **Published Heroic Split** cannot self-withdraw.

### Testing roster management with development identities

After `npm run db:seed`:

- **Thorne (RAID_LEAD)** — `/manage/runs` lists assigned runs. **Sunday Heroic Boost** is already rostering with a composition-warning draft (3/4 healers). **Weekend Heroic Catch-up** is `Build Roster`. **Published Heroic Split** uses **Edit Published Roster** (live `SELECTED` rows stay until a replacement publish).
- **Aelira (ADMIN)** — can open **US Evening Normal Clear**, which is assigned to her, and any Thorne-led run.
- **Kael (USER)** — `/manage` redirects to the dashboard. Direct `/manage/runs/...` URLs are rejected the same way.

Roster Lab Heroic is seeded for automated tests; prefer Sunday / Weekend / Published Heroic Split for visual QA.

## Main routes

| Route | Access |
| --- | --- |
| `/` | Public login |
| `/dashboard` | Authenticated |
| `/runs` | Authenticated |
| `/my-runs` | Authenticated |
| `/characters` | Authenticated |
| `/profile` | Authenticated |
| `/manage` | RAID_LEAD or ADMIN |
| `/manage/runs` | RAID_LEAD or ADMIN |
| `/manage/runs/[runId]` | RAID_LEAD (assigned run) or ADMIN |

## Documentation

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Authentication](docs/authentication.md)
- [Development](docs/development.md)
- [Application shell](docs/features/application-shell.md)
- [Run signups](docs/features/run-signups.md)
- [Roster management](docs/features/roster-management.md)

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run db:emit
npm run db:migrate
npm run db:seed
npm run db:verify
```
