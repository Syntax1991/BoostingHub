# Boostting Bot

Internal World of Warcraft boosting operations platform for boosters, lootbuddies, raid leads, and administrators.

Boostting Bot is a **web application**. A Discord bot is a later integration, not the product.

This repository is on **main**. Character Management, Booster Access Management, Canonical Run detail, Run Management, and Run lifecycle/attendance are implemented.

Existing boosting-community platforms inspired workflow thinking only. Their branding, assets, source, and visual identity are not copied.

## Phase status

- **Phase 1 — Foundation — Complete**
- **Phase 2 — Real Run Signup Workflow — Complete**
- **Phase 3 — Roster Management — Complete**
- **Phase 4 — Production Data Transition Foundation — Complete**
- **Character Management — Complete**
- **Booster Access Management — Complete**
- **Canonical Run Detail — Complete**
- **Run Management — Complete**
- **Run lifecycle and attendance — Complete**

Phase 1 delivered the application shell, auth, MVCS, and seeded domain models.

Phase 2 makes `/runs` persist BOOSTER and LOOTBUDDY signups, with eligibility from `BoosterAccessService` and `LockoutService`, and self-withdrawal on `/my-runs`.

Phase 3 adds persistent draft selection, composition warnings, and transactional roster publication on the canonical Run detail Roster tab.

Phase 4 establishes the GitHub workflow and treats seed data as a fixture, not required production state.

Character Management lets a Discord user add, edit, deactivate, and reactivate owned characters. Battle.net sync is still deferred.

Booster Access Management lets that user request eligibility from character details and lets an ADMIN approve, reject, or revoke it.

Canonical Run detail puts every Run at `/runs/[runId]`, with participant data for USER and roster tools for the assigned raid lead or an ADMIN.

Run Management lets a raid lead create a self-led draft (or an admin assign an eligible lead), edit planning fields, open the run, toggle the signup window, and cancel without deleting history.

Run lifecycle and attendance lets the assigned raid lead or an admin start a published run, record attendance, and complete it when every participant is marked.

Not implemented (intentionally deferred):
- Post-completion attendance corrections, payouts, gold ledger
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

Client interactivity is isolated: `AppShell`, `Button`, Discord sign-in, run filters, the signup dialog, withdraw, roster builder, run detail tabs, character create/edit/lifecycle, booster-access dialogs, and run create/edit/cancel/lifecycle actions.

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

Discord login is the real user path. Until those values are set, Discord login is hidden. Development identities remain available when `DEV_AUTH_ENABLED=true` and `NODE_ENV` is not `production`.

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

- **Thorne (RAID_LEAD)** — `/manage/runs` lists assigned runs. Actions open `/runs/[runId]`. **Sunday Heroic Boost** is already rostering with a composition-warning draft (3/4 healers). **Weekend Heroic Catch-up** is `Build Roster`. **Published Heroic Split** uses **Edit Published Roster** (live `SELECTED` rows stay until a replacement publish).
- **Aelira (ADMIN)** — can open **US Evening Normal Clear**, which is assigned to her, and any Thorne-led run.
- **Kael (USER)** — `/manage` redirects to the dashboard. `/runs/[runId]` shows participant data only. Old `/manage/runs/...` URLs redirect to the canonical Run.

Roster Lab Heroic is seeded for automated tests; prefer Sunday / Weekend / Published Heroic Split for visual QA.

### Testing run management with development identities

Seeded runs are fixtures. A real raid lead does not need them.

- **Thorne (RAID_LEAD)** — `/manage/runs` → **Create Run**. Raid lead is fixed to Thorne. The new run is a draft with signups closed. Open it from `/runs/[runId]`, then close/reopen signups. Thorne cannot reassign the lead or manage Aelira’s runs.
- **Aelira (ADMIN)** — can assign Thorne (or herself) as raid lead, edit any run before publish, and cancel.
- **Kael (USER)** — no Create Run. Drafts are not listed on `/runs` and draft URLs 404.

See [docs/features/run-management.md](docs/features/run-management.md).

### Testing character management

A Discord user with zero characters can use `/characters` → **Add Character**. Seed is not required.

With a development identity:

- **Kael** — `/characters` lists three Shamans (one inactive). Details, edit, deactivate, and reactivate are owner-only.
- Create a new alt, confirm Dashboard/Profile counts change, then sign the alt as lootbuddy on an open run. It must not appear as a booster without BoosterAccess.

See [docs/features/character-management.md](docs/features/character-management.md).

## Main routes

| Route | Access |
| --- | --- |
| `/` | Public login |
| `/dashboard` | Authenticated |
| `/runs` | Authenticated |
| `/runs/[runId]` | Authenticated; manager tools only when authorized |
| `/my-runs` | Authenticated |
| `/characters` | Authenticated |
| `/characters/[characterId]` | Owner only |
| `/profile` | Authenticated |
| `/manage` | RAID_LEAD or ADMIN |
| `/manage/runs` | RAID_LEAD or ADMIN |
| `/manage/runs/new` | RAID_LEAD or ADMIN |
| `/manage/runs/[runId]` | Compatibility redirect to `/runs/[runId]` |

## Documentation

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Authentication](docs/authentication.md)
- [Development](docs/development.md)
- [Git workflow](docs/git-workflow.md)
- [Application shell](docs/features/application-shell.md)
- [Character management](docs/features/character-management.md)
- [Booster access management](docs/features/booster-access-management.md)
- [Canonical run detail](docs/features/run-detail.md)
- [Run management](docs/features/run-management.md)
- [Run signups](docs/features/run-signups.md)
- [Roster management](docs/features/roster-management.md)
- [Run lifecycle and attendance](docs/features/run-lifecycle-attendance.md)

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
