# BoostingHub developer guide

The authoritative reference for how BoostingHub is built: architecture, data model, local setup, tests, authorization and the business rules of every feature.

Related documents: [API.md](API.md) (HTTP routes and Server Actions), [USER.md](USER.md) (using the app), [DEPLOYMENT.md](DEPLOYMENT.md) (releases), [OPERATIONS.md](OPERATIONS.md) (running the services), [HANDOVER.md](HANDOVER.md) (project status).

Naming: the product is **BoostingHub**, the app brand shown to users is **Manawyrm Hub** (`APP_BRAND_NAME`), and some technical names still say `boostting` (`package.json`, seed e-mail domain, example database names).

## Contents

- [Contents](#contents)
- [Start here](#start-here)
- [Architecture and MVCS](#architecture-and-mvcs)
  - [Stack](#stack)
  - [Layer responsibilities](#layer-responsibilities)
  - [Persistence boundary](#persistence-boundary)
  - [Authorization boundary](#authorization-boundary)
  - [Rules for later contributors](#rules-for-later-contributors)
- [Project structure](#project-structure)
  - [Directory structure](#directory-structure)
- [Local development](#local-development)
  - [Prerequisites](#prerequisites)
  - [First run](#first-run)
  - [Seed](#seed)
  - [Temporary Prisma Postgres](#temporary-prisma-postgres)
  - [Time display](#time-display)
  - [Seed policy](#seed-policy)
  - [Development account bootstrap](#development-account-bootstrap)
  - [Discord OAuth locally](#discord-oauth-locally)
  - [Development identities](#development-identities)
  - [Character management QA](#character-management-qa)
- [Data model and Prisma](#data-model-and-prisma)
  - [Distinctions that must not collapse](#distinctions-that-must-not-collapse)
  - [User](#user)
  - [BattleNetConnection](#battlenetconnection)
  - [BattleNetImportSession](#battlenetimportsession)
  - [Character](#character)
  - [Boosting Roles (on User)](#boosting-roles-on-user)
  - [Legacy BoosterAccess (history)](#legacy-boosteraccess-history)
  - [Raid / RaidBoss](#raid--raidboss)
  - [CharacterRaidLockout](#characterraidlockout)
  - [Run](#run)
  - [RunSignup](#runsignup)
  - [RunRoster / RunRosterEntry](#runroster--runrosterentry)
  - [RunAttendance](#runattendance)
  - [RunConsumableAudit](#runconsumableaudit)
  - [WarcraftLogsReport / RunWarcraftLogsReport / RunWarcraftLogsFight](#warcraftlogsreport--runwarcraftlogsreport--runwarcraftlogsfight)
  - [No financial domain](#no-financial-domain)
  - [Strike](#strike)
  - [RunDiscordPost](#rundiscordpost)
  - [ActivityEvent](#activityevent)
  - [Other models](#other-models)
  - [Prisma 8](#prisma-8)
  - [Prisma 8 workflow](#prisma-8-workflow)
  - [Incremental Prisma migrations](#incremental-prisma-migrations)
- [Tests, build and quality](#tests-build-and-quality)
  - [Validation](#validation)
  - [Test setup](#test-setup)
  - [Discord bot test coverage](#discord-bot-test-coverage)
- [Authentication and authorization](#authentication-and-authorization)
  - [Discord OAuth](#discord-oauth)
  - [Battle.net (secondary connection)](#battlenet-secondary-connection)
  - [Development authentication](#development-authentication)
  - [Development account bootstrap](#development-account-bootstrap-1)
  - [Session enforcement](#session-enforcement)
  - [Account Roles](#account-roles)
  - [Platform Owner](#platform-owner)
  - [Last Admin](#last-admin)
  - [Active Run Safety](#active-run-safety)
  - [Session Role Freshness](#session-role-freshness)
- [Feature rules](#feature-rules)
  - [Application shell](#application-shell)
  - [User management](#user-management)
  - [Boosting Roles](#boosting-roles)
  - [User strikes](#user-strikes)
  - [Character management](#character-management)
  - [Lockout boss-dot semantics](#lockout-boss-dot-semantics)
  - [Battle.net integration](#battlenet-integration)
  - [Scheduled character sync](#scheduled-character-sync)
  - [Character Operations](#character-operations)
  - [Raid Catalog](#raid-catalog)
  - [Run Setups](#run-setups)
  - [Community Schedule](#community-schedule)
  - [Run management](#run-management)
  - [Canonical Run detail](#canonical-run-detail-1)
  - [Run signups](#run-signups)
  - [Roster management](#roster-management)
  - [Run lifecycle and attendance](#run-lifecycle-and-attendance)
  - [Run Consumables Audit](#run-consumables-audit)
  - [User settings and notifications](#user-settings-and-notifications)
  - [Discord bot](#discord-bot)
  - [Operational analytics and system health](#operational-analytics-and-system-health)
- [Technical decisions](#technical-decisions)
- [Git workflow](#git-workflow)
  - [Stable branch](#stable-branch)
  - [Feature branches](#feature-branches)
  - [Branch granularity](#branch-granularity)
  - [Commit granularity](#commit-granularity)
  - [Validation before PR](#validation-before-pr)
  - [Merge](#merge)
  - [Cleanup](#cleanup)
  - [Emergency / fix branches](#emergency--fix-branches)

## Start here

**First day:** read this section, [Architecture and MVCS](#architecture-and-mvcs) and [Project structure](#project-structure), then follow [Local development](#local-development). Everything under [Feature rules](#feature-rules) is reference: read the part you are about to change.

**Terms you need:**

| Term | Meaning |
| --- | --- |
| Run | One planned raid, at `/runs/[runId]` |
| Run status | `DRAFT` → `OPEN` → `ROSTERING` → `PUBLISHED` → `IN_PROGRESS` → `COMPLETED`, or `CANCELLED` before Start |
| Account role | Permission in the app: `USER`, `RAID_LEAD`, `ADMIN`, `OWNER` |
| Boosting Role | Capability on the account: Booster, Lootbuddy. Not an account role |
| Offer, signup | A `RunSignup` row. Signing up never means being selected |
| Draft, published roster | The saved selection, and the `SELECTED` signups after Publish. Start Run freezes the roster |
| Run Setup | Global planning preset, model `RunTemplate` |
| Product | Raid content offered for creating Runs, managed in the Raid Catalog |
| Raid ID | The week from Wednesday 06:00 Europe/Berlin to the next, used for Discord sections and filters. Lockouts use Blizzard's regional reset instead |
| Lane | One kind of work in the bot's sync payload |
| VERIFIED, PUBLIC sync | A Character sync through a proven Battle.net link, or from public profile data |

**Where do I look?**

| I want to change | Read |
| --- | --- |
| Who may do what | [Authentication and authorization](#authentication-and-authorization), [User management](#user-management), [Boosting Roles](#boosting-roles) |
| Characters and Blizzard data | [Character management](#character-management), [Battle.net integration](#battlenet-integration), [Scheduled character sync](#scheduled-character-sync) |
| What can be planned | [Raid Catalog](#raid-catalog), [Run Setups](#run-setups), [Community Schedule](#community-schedule) |
| A Run from create to complete | [Run management](#run-management), [Run signups](#run-signups), [Roster management](#roster-management), [Run lifecycle and attendance](#run-lifecycle-and-attendance) |
| Logs and consumables | [Run Consumables Audit](#run-consumables-audit) |
| Messages to players | [User settings and notifications](#user-settings-and-notifications), [Discord bot](#discord-bot) |

## Architecture and MVCS

BoostingHub is a modular Next.js application with an internal **MVCS** boundary. There is no separate backend service for the Web app itself — the one exception is the Discord bot, a genuinely separate long-lived Node process that reaches BoostingHub only through a dedicated internal API (see Discord Bot API below), never through Prisma or a Repository directly.

### Stack

- Next.js 16 App Router, React, TypeScript, Tailwind CSS (exact versions in `package.json`)
- PostgreSQL 15+
- Prisma ORM 8 for domain persistence
- Better Auth for sessions and OAuth
- Zod at HTTP/form boundaries

MVCS is used because later boosting operations will accumulate non-trivial rules around eligibility, lockouts, rostering, and attendance. Those rules must stay testable outside React trees.

### Layer responsibilities

#### Model

Persistent domain entities, Prisma contract, relationships, and domain enums. No presentation logic.

#### View

React pages and components: layout, tables, badges, filters, empty states. Views consume prepared data. They do not query Prisma and do not decide whether a signup transition is legal.

Client components are limited to interaction islands (`AppShell` navigation, `Button`, Discord OAuth click, run filters, signup dialog, withdraw button, roster builder, run detail tabs, character form, character lifecycle, Battle.net connect/import panels, booster access request/review dialogs, run create form, run edit/cancel/start/complete dialogs, attendance table, manager lifecycle actions). Shared presentation primitives are not marked `"use client"` so tables stay server-rendered.

#### Controller

Server actions, route handlers, and page loaders. Typical shape:

1. Authenticate
2. Authorize
3. Validate input
4. Call a service
5. Return a result

Better Auth's `/api/auth/*` handler is the authentication controller for OAuth and credential login.

#### Service

Application and business rules: Boosting Roles (Booster / Lootbuddy grant/revoke, legacy booster request review), Booster role check, lockout conflict, run/signup state machines, run create/edit/open/signup-window/cancel/start/complete, signup eligibility, multi-character offer reconciliation, roster draft/publish, attendance snapshot/update/completeness and post-completion correction, User disciplinary strikes, canonical run-detail DTO shaping, character identity/lifecycle, Battle.net connect/import/link/refresh, dashboard composition, Discord sync-work computation and embed DTO shaping.

#### Repository

Prisma 8 access lives here (`orm.Model` via `src/lib/prisma.ts`). Inside `db.transaction`, use `tx.orm.public` (typed `typeof orm`) — do not cast `tx.orm` through `unknown`. Views and most controllers never import Prisma.

#### External integrations

Outbound HTTP to third parties belongs under `src/integrations/`, not in Views or Controllers. The Battle.net / Blizzard client (`src/integrations/blizzard/blizzard-api-client.ts`) is the only place that talks to Blizzard OAuth and regional profile APIs. Likewise `src/integrations/warcraft-logs/warcraft-logs-api-client.ts` is the only Warcraft Logs client (character identity, rankings, and report fights/events for the Run Consumables Audit). Services call that client; they do not scatter raw `fetch` calls across the app.

#### Discord Bot API

`src/app/api/bot/*` Route Handlers are the only path the separate Discord bot process (`src/discord-bot/`, its own long-lived Node process) may use to reach BoostingHub — never direct Repository or Prisma access. Inbound, not outbound: the bot calls in, authenticated by a dedicated service token (`BOOSTINGHUB_BOT_API_TOKEN`, constant-time compared) that grants access to the bot surface only, never a domain-role bypass. Every per-User mutating call still resolves a real acting User from the Discord-authenticated `discordUserId` and runs the exact same Service the Web Controllers call, so eligibility rules can never drift between the two surfaces. Calls without an acting User are the sync and delivery bookkeeping routes (see [API.md](API.md)) and Warcraft Logs automation: linking a report posted by a configured log bot in a Run's own channel (re-checked server-side against `DISCORD_WCL_REPORT_AUTHOR_IDS` and the stored Run channel) and the post-completion Consumables Audit tick. See [Discord bot](#discord-bot).

### Persistence boundary

```text
View → Controller → Service → Repository → Prisma 8 (`db.orm.public`)
                                         → PostgreSQL
```

Better Auth (Kysely) and Prisma 8 share one `pg.Pool` (`src/lib/pg-pool.ts`) so they cannot exhaust a small hosted connection limit against each other. Domain tables are owned by Prisma migrations. The `user` table is the shared identity record.

### Authorization boundary

Cookie presence in `src/proxy.ts` is an optimistic redirect only.

Server-side enforcement:

- `requireUser()`
- `requireRaidLead()`
- `requireAdmin()`
- `requireAdminOrRedirect()`
- `requireManagerOrRedirect()`
- `canManageRun` / `assertCanManageRun` (raid lead owns assigned runs; admin owns all)
- `canViewRunConsumableAudit` / `assertCanViewRunConsumableAudit` (same rule; Run Consumables Audit)

Hidden buttons are not an authorization control.

### Rules for later contributors

1. Do not put business rules in page components.
2. Do not call Prisma from Views.
3. Do not grow Controllers into domain engines.
4. Keep run status and signup status separate.
5. Keep account roles separate from BOOSTER / LOOTBUDDY participation.
6. Keep signup eligibility in Services. Views receive evaluated options and `canWithdraw`.
7. Keep roster draft selection off `RunSignup.status` until Publish. Views must not invent composition or publish rules.
8. Keep booster eligibility in `boostingRoleService` (`isApprovedBooster` / `hasEffectiveBoosterAccess`). `BoosterAccess` rows are history and are never read for eligibility. Only ADMIN / OWNER grant or revoke Boosting Roles.
9. Keep account-role administration in `userManagementService`. Hidden Manage links are not authorization.
10. Update documentation in the same change that alters architecture or domain behavior.
11. Treat seed data as a development/test fixture, not required production state.
12. Do not hard-code seeded user or run IDs in production services.
13. The Discord bot process never imports a Service or Repository directly — it is a client of `/api/bot/*` like any other. Never let it read PostgreSQL.

## Project structure

### Directory structure

```text
src/
  app/             View routes, Better Auth handler, integration route handlers, /api/bot/* (Discord Bot API)
  components/      View components
  controllers/     Thin application boundary
  services/        Business rules
  domain/          Pure business rules: no database, no network; views, services and repositories may import them
  repositories/    Prisma access
  integrations/    External HTTP clients (e.g. Blizzard)
  models/          Domain enumerations
  validators/      Zod schemas
  auth/            Auth configuration and authorization helpers
  lib/             Cross-cutting utilities
  prisma/          Prisma 8 contract, client, seed
  discord-bot/     Separate long-lived process (discord.js) — calls /api/bot/* only, never Prisma/Repositories
tests/             Every test; src/ holds production code only (see Test setup)
  unit/            No database: pure rules, components, clients, bot logic. Mirrors src/
  integration/     Real database or real subprocesses: services, repositories, routes, deploy scripts. Mirrors src/ and deploy/
  fixtures/        Typed test data factories: actors, database rows, clocks, Run inputs
  helpers/         Shared test helpers: bot requests, signup offers, domain-error assertions, source paths
  setup/           Vitest global setup (test-database guard) and per-file setup (external API guard)
```

Main app routes (all in `src/app/(app)/` except the public login):

| Route | Access |
| --- | --- |
| `/` | Public login |
| `/dashboard`, `/runs`, `/my-runs`, `/characters`, `/profile`, `/settings`, `/notifications` | Signed in |
| `/runs/[runId]` | Signed in; manager tools only when authorized; drafts are managers only |
| `/runs/[runId]/archive-transcript` | Manager download, see [API.md](API.md#archive-transcript-download) |
| `/runs/create` | RAID_LEAD and above |
| `/characters/[characterId]` | Owner only |
| `/profile/templates` | RAID_LEAD and above, read-only Run Setups |
| `/manage`, `/manage/runs`, `/manage/schedule` | RAID_LEAD and above; Schedule mutations ADMIN / OWNER |
| `/manage/users`, `/manage/users/[userId]`, `/manage/characters`, `/manage/characters/[characterId]`, `/manage/raid-catalog`, `/manage/raid-catalog/raids/[raidId]`, `/manage/templates`, `/manage/analytics`, `/manage/system` | ADMIN / OWNER |

Compatibility redirects: `/manage/runs/create` and `/manage/runs/create-many` to `/runs/create`; `/manage/runs/[runId]` to `/runs/[runId]`; `/manage/boosting-roles` and `/manage/booster-access` to `/manage/users`; `/manage/content` to `/manage/raid-catalog`.

Other top-level folders:

| Path | Content |
| --- | --- |
| `migrations/app/` | Committed Prisma migrations, applied by `npm run db:migrate` |
| `migrations/snapshots/` | Contract snapshots belonging to those migrations |
| `scripts/` | One-shot jobs, maintenance and diagnostic scripts (below) |
| `deploy/` | Release helper, systemd reference units, backup and env-check scripts; see [DEPLOYMENT.md](DEPLOYMENT.md) |
| `docs/guides/screenshots/` | Guide screenshots; the path is read by the guide publishers and capture scripts |
| `src/guides/` | Canonical text of the Discord guides |

Scripts:

| Script | Purpose | npm script |
| --- | --- | --- |
| `sync-blizzard-characters.ts` | One-shot character sync | `sync:characters` |
| `materialize-community-schedule.ts` | Weekly Schedule Draft release | `materialize:community-schedule` |
| `reconcile-battlenet-links.ts` | Exact-match Battle.net link backfill | `reconcile:battlenet-links` |
| `owner-bootstrap.mts` | One-time Platform Owner bootstrap | `owner:bootstrap` |
| `check-dev-db-schema.ts` | Read-only schema check before `next dev` | `predev` |
| `test-db-reset.ts` | Destructively resets `TEST_DATABASE_URL` only | `test:db:reset` |
| `capture-guide-screenshots.mts`, `capture-raidlead-guide-screenshots.mts` | Playwright guide screenshots | `guide:screenshots`, `guide:raidlead:screenshots` |
| `publish-guide.mts` | Discord guide publishers | `guide:*:preview`, `guide:*:publish` |
| `record-backup-telemetry.mts` | Backup outcome as `IntegrationEvent` | none (called by the backup script) |
| `generate-wow-item-sockets.mjs` | Regenerates the socket table after a content patch | none |
| `build-spec-icon-map.mts` | Regenerates the specialization icon map | none |

Production timers run `sync:characters`, `materialize:community-schedule` and `reconcile:battlenet-links`. The backup timer runs the root-owned copy of `deploy/production/backup-db.sh`, which calls `record-backup-telemetry.mts`.

Other tools outside `scripts/`:

| Tool | Purpose | How it runs |
| --- | --- | --- |
| `src/prisma/seed.ts` | **Wipes every seeded table**, then inserts fixtures. `seed-guard.ts` reads the target through the `pg` driver, then refuses production, non-local hosts, connection parameters other than `sslmode` and `application_name`, and any target not named in `SEED_CONFIRM_DATABASE` | `db:seed` |
| `src/discord-bot/register-commands.ts` | Registers the Discord slash commands | `bot:register-commands`, by hand |
| `deploy/update-server.sh` | The only release path | By hand on the server |
| `deploy/production/backup-db.sh`, `env-status.py` | Backup and read-only `.env` check | Timer, by hand |
| `tests/integration/deploy/update-server.test.sh`, `tests/integration/deploy/production/*.test.sh` | Stub tests of the deployment scripts; they need bash and `python3` | By hand, no npm script and no CI |

## Local development

### Prerequisites

- Node.js 24
- npm
- PostgreSQL 15+ (local, Docker, or Prisma Postgres via `npx create-db@latest`)

### First run

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run db:emit
npm run db:migrate
npm run db:seed
npm run dev   # checks the DB schema first (read-only), see "Schema check before npm run dev"
```

After pulling changes that add migrations, run `npm run db:migrate` before `npm run dev` — the dev check tells you when it is needed.

`--legacy-peer-deps` is required because Better Auth still optionally peers Prisma 5–7 while this app uses Prisma 8 for domain data.

`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, and `BLIZZARD_REDIRECT_URI` (see `.env.example`) are required for Add Character — Class/Item Level come from Blizzard's public Character Profile with no manual fallback. Optional Battle.net *account* linking/import uses the same vars. Seed and Discord login work when they are empty; adding a Character does not.

Optional `DISCORD_BOOSTER_TICKET_URL` is an external Discord link for Booster applications, shown as **Apply via Discord** when self-service BoosterAccess requests are disabled.

### Seed

**This deletes existing data.** It runs only against a local database named exactly in `SEED_CONFIRM_DATABASE` (an existing `.env` needs this key added). `npm run db:seed` wipes domain and auth rows, then upserts reference raid content and inserts deterministic users, characters, access, lockouts, fixture runs, signups, attendance, and activity.

It is safe to re-run. It is not random. Seed is a fixture, not required production state; see **Seed policy** below.

Default password: `dev-login-only` (override with `DEV_AUTH_PASSWORD`).

Tests under `tests/integration/` run against `TEST_DATABASE_URL`, which `npm run test:db:reset` migrates and seeds. Most audited suites create their own users, Characters and Runs with fresh ids and delete exactly those rows; they may read seeded rows through `SEED_IDS` (`src/prisma/seed-ids.ts`). A few suites still mutate seeded Roster Lab fixtures (notably `tests/integration/services/roster.service.test.ts` for **Roster Lab Heroic**); re-seed after them if you need the original demo rows. The test audit on `test/audit-batch-a` is complete — see [docs/audit/FINAL-ENGINEERING-HANDOVER.md](audit/FINAL-ENGINEERING-HANDOVER.md).

### Temporary Prisma Postgres

If `npx create-db@latest` was used, unclaimed databases expire after 24 hours. Put the connection string only in `.env`. Claim the printed URL to keep the database.

### Time display

Timestamps are stored in UTC. Personal surfaces format them with the User's Settings timezone (default `Europe/Berlin`): Dashboard, My Runs, Notifications, `/runs`, and the Run start time on Run detail (header, Overview, signup dialog). Other Run detail timestamps (history, WCL, consumables) and manage screens still use `Europe/Berlin`. Community/server authority — Run titles, Discord channel names, raid-ID week boundaries — remains `Europe/Berlin` via `DEFAULT_TIME_ZONE`. Month names are avoided (`Thu 10/09/2026 21:00`) because Node and browsers disagree on `en-GB` abbreviations such as `Sept` vs `Sep`.

### Seed policy

Seed data is a development and test fixture.

It is useful for local QA and deterministic Vitest runs. It is **not** required production state.

The application must work when the database contains only a newly authenticated Discord user: zero characters, zero runs, zero signups, zero roster data.

Seed itself does not require Battle.net — it inserts Characters directly. Interactive local QA of Add Character does: `BLIZZARD_*` must be set, since Class/Item Level have no manual fallback. Battle.net *account* linking stays optional on top of that and is documented in [Battle.net integration](#battlenet-integration).

Do not encode seeded user IDs or seeded run titles in production services.

### Development account bootstrap

`npm run db:seed` resets `accountRole`/`accountStatus` and Boosting Roles for everyone, including your real Discord account. To avoid re-granting yourself ADMIN by hand after every reseed, set in `.env`:

```bash
DEV_ACCOUNT_BOOTSTRAP_ENABLED="true"
DEV_ADMIN_DISCORD_USER_ID="<your real Discord user ID>"
```

The next time that Discord account signs in (new or returning session), it is automatically restored to `ADMIN`/`ACTIVE` with the Booster role (`isBooster`). Hard-disabled in production regardless of these env vars; a non-matching Discord user is never affected; no Activity is logged for it. See [Development account bootstrap](#development-account-bootstrap) for the full behavior.

Leave `DEV_ACCOUNT_BOOTSTRAP_ENABLED="false"` unless you specifically need this, and never commit your real Discord user ID.

`--legacy-peer-deps` stays required. All configuration keys are listed in [OPERATIONS.md](OPERATIONS.md#configuration-and-environment-variables); `.env.example` is the template.

### Discord OAuth locally

Create an application in the Discord Developer Portal and register the redirect URL `http://localhost:3000/api/auth/callback/discord`. Discord login is hidden until `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set. Development identities remain available when `DEV_AUTH_ENABLED=true` and `NODE_ENV` is not `production`.

### Development identities

Seeded identities (password from `DEV_AUTH_PASSWORD`):

| Identity | Account role |
| --- | --- |
| `kael@dev.boostting.local` | USER |
| `mira@dev.boostting.local` | USER |
| `brann@dev.boostting.local` | USER |
| `sylva@dev.boostting.local` | USER |
| `thorne@dev.boostting.local` | RAID_LEAD |
| `aelira@dev.boostting.local` | ADMIN |

Useful seeded situations (details in `src/prisma/seed.ts`):

- **Thorne**: `/manage/runs` lists assigned Runs in several lifecycle states, including **Sunday Heroic Boost** (rostering), **Weekend Heroic Catch-up** (open) and **Published Heroic Split** (published). Thorne cannot reassign the lead or manage Aelira's Runs.
- **Aelira**: can assign a Raid Lead, and can open and edit any Run before Start.
- **Kael**: `/manage` redirects to the dashboard, `/runs/[runId]` shows participant data only, drafts are not listed and draft URLs 404. `/characters` lists three Shamans, one inactive.
- **Roster Lab Heroic** is seeded for automated tests. Prefer the other Runs for visual QA.

### Character management QA

Requires `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, and `BLIZZARD_REDIRECT_URI` set — Add Character always looks up Blizzard's public Character Profile.

1. Sign in with Discord (empty account) or a development identity.
2. Open `/characters` → **Add Character**, paste a Raider.IO profile link of a real EU or US character, confirm Class and Item Level render read-only from Blizzard, then choose a specialization and add.
3. Open Details, edit name/realm/region/specialization; confirm Class and Item Level are not editable.
4. Confirm Dashboard and Profile counts follow `activeCharacters` / `totalCharacters`.
5. On `/runs`, any user can add a characterless Lootbuddy entry; a new active character cannot booster-sign until an ADMIN grants the account the Booster role.
6. From character details, open the Discord booster application CTA (when configured); as ADMIN, grant the Booster role on `/manage/users/[id]` and confirm booster signup becomes available on every difficulty.

The same vars also enable Battle.net account **Connect** on `/characters` and **Refresh** on linked character details — separately optional, ownership-verified, on top of the Add Character lookup above.

## Data model and Prisma

Timestamps are stored as `timestamptz` (UTC). Formatting happens in `src/lib/datetime.ts`.

### Distinctions that must not collapse

| Concept | Meaning | Examples |
| --- | --- | --- |
| Account permission | What the account may do in the app | `USER`, `RAID_LEAD`, `ADMIN`, `OWNER` |
| Boosting Roles | Operational capabilities on the account, independent of each other and of the account role | Booster, Lootbuddy |
| Run participation type | How this person is on **this** run | `BOOSTER`, `LOOTBUDDY` |
| Run status | Lifecycle of the operation | `OPEN`, `ROSTERING` |
| Signup status | Lifecycle of one signup row | `PENDING`, `SELECTED` |

Account role (authorization) and Boosting Roles (operational participation) are separate: a User may hold zero, one or both Boosting Roles whatever the account role. Run participation is still chosen per signup — the same account can boost Run A and join Run B as a lootbuddy.

### User

Application account and Better Auth `user` row.

- `id`, `name` (display name), optional `email`
- **Player names**: `name` is resolved from Discord (`src/lib/discord-display-name.ts`): server nickname → global display name → username, with a trailing `-<Realm>` dropped only when it is a known realm (a stored Character's realm). The raw inputs are kept in `discordGuildNickname` / `discordGlobalName` / `discordUsername`; `discordNameSyncedAt` marks the last authoritative read. Refreshed on every login-time guild member read and by the bot's bounded refresh (`discord-member-name-sync.service`); a Discord failure keeps the last known name, HTTP 404 clears only the server nickname. Display only — identity stays `discordUserId` / `id`. `discordRunChannelNickname` is deprecated (no longer read or written).
- Discord user id, username, avatar (`image`)
- `accountStatus`: `ACTIVE` \| `DISABLED`
- `accountRole`: `USER` \| `RAID_LEAD` \| `ADMIN` \| `OWNER` (hierarchical; ADMIN assigns USER/RAID_LEAD/ADMIN via user management; the single, protected OWNER is only set by `npm run owner:bootstrap`; never OAuth self-promote)
- timestamps

Email is optional for core behavior. Discord is the primary identity.

### BattleNetConnection

Optional regional Battle.net link for a BoostingHub user. Unique on `(userId, region)` (`EU` \| `US`).

Stores Battle.net account id, optional BattleTag, scope metadata, `connectedAt`, and `lastSuccessfulSyncAt`. User OAuth tokens are **never** persisted here. Discord remains login; this is a secondary game-account connection. See [Battle.net integration](#battlenet-integration).

### BattleNetImportSession

Short-lived (~15 min) owned-character snapshot after OAuth. Holds JSON character candidates for import/link selection. Stores no tokens. Clients may only select ids present in this snapshot.

### Character

Belongs to one user. Operators add characters via Blizzard lookup (Add Character) or import/link them from Battle.net. The same Character row is used either way.

- display `name`, `realm`, `region` (`EU` \| `US`)
- `normalizedName` / `normalizedRealm` for owner-scoped case-insensitive uniqueness with region
- unique on `(userId, region, normalizedRealm, normalizedName)`
- class (Blizzard-authoritative), specialization (BoostingHub-owned), primary role (`TANK` \| `HEALER` \| `MELEE_DPS` \| `RANGED_DPS`, derived from specialization; historic rows may hold generic `DPS`)
- item level: `Int?`, Blizzard `equipped_item_level` when available, `null` ("Unknown") otherwise — never user-entered, never a `0` sentinel
- `isActive` lifecycle (deactivate instead of delete)
- optional scoped Blizzard identity: `blizzardCharacterId` + `blizzardRealmId` with `region`; unique on `(region, blizzardRealmId, blizzardCharacterId)` when set
- optional Warcraft Logs identifier (`warcraftLogsId`, used for outbound links and to prefer an exact player match in reports)
- `lastSyncedAt` set after a successful Blizzard profile sync
- sync telemetry: `lastSyncAttemptAt`, `lastSyncErrorAt`, `lastSyncErrorCode` (safe fixed category), `syncFailureCount` — see [Sync telemetry](#sync-telemetry)

Class is immutable after creation. Specialization from Blizzard is import-time prefill only; afterward it stays BoostingHub-owned. `primaryRole` is derived from specialization; signup role must still be valid for the class. Disconnecting Battle.net does not delete Characters. See [Character management](#character-management) and [Battle.net integration](#battlenet-integration).

### Boosting Roles (on User)

Two independent booleans on the User, both default `false`, never an `accountRole` and never stored on a Character. See [Boosting Roles](#boosting-roles).

- `isBooster` — approved to sign up and be rostered as a Booster. **Not scoped by raid difficulty**: a Booster qualifies for Normal, Heroic and Mythic Runs alike; Run difficulty stays a Run / lockout / weekly-availability concept. Characters use the owner's role; they do not own it.
- `isLootbuddy` — recognised Lootbuddy. Management/display only; Lootbuddy signups are not gated by it.

Changed only by ADMIN / OWNER through explicit grant/revoke operations, audited as `BOOSTER_GRANTED` / `BOOSTER_REVOKED` / `LOOTBUDDY_GRANTED` / `LOOTBUDDY_REVOKED`.

### Legacy BoosterAccess (history)

Preserved historical applications: User + Class + Role + Difficulty (+ optional Character context). Statuses include `PENDING` (legacy queue only). HISTORICAL REQUEST only — the recorded difficulty is history, and no row is ever read for current eligibility (that is `User.isBooster`).

### Raid / RaidBoss

Reusable **reference content**, not demo users or demo Runs. Catalog: `src/lib/wow-raid-catalog.ts`. `raidRepository.ensureReferenceRaids()` upserts it idempotently (seed and Run create/edit). Dev seed still adds fixture Runs around that content. Blizzard raid ingestion is deferred.

A Raid's **total boss count** is never a stored field — it is computed by counting that Raid's `RaidBoss` rows (`raidRepository` includes the `bosses` relation and returns `totalBossCount` as `bosses.length`). Each `RunRaidContent.plannedBossCount` is validated against that content raid's computed total, never against a duplicate stored number on `Run`.

### CharacterRaidLockout

Lockout is **not** `character.locked = true`.

It depends on character + raid + difficulty + `resetIdentifier`.

`resetIdentifier` is an ISO-week style string (e.g. `2026-W37`), but for Blizzard sync and Signup/Roster matching it is derived from the **Character region's regional WoW reset start** via `getRegionalWeeklyReset(region, instant).resetIdentifier` — never from the Run wall-clock's ISO week alone.

Example (EU): a Run on Monday 14 September 2026 still belongs to the reset that started Wednesday 09 September 2026 (`2026-W37`). Looking up lockouts with `resetIdentifierFor(run.scheduledStartAt)` would incorrectly use `2026-W38` and miss the persisted row.

Heroic and Mythic lockouts for the same raid week are independent.

Verified `0/N` (a `CharacterRaidLockout` row with `bossesDefeated = 0`) means **verified Unsaved** for that exact key. **No row** means **Unknown** — never invent `0/N` from absence.

`UNSAVED` and `VIP` Runs share the same fresh-lockout attention semantics (`requiresFreshRaidLockout`); `SAVED` Runs may still show progress but do not treat progress as attention/error. Lockouts remain **informational** for signup/roster/publish — never a hard `LOCKOUT_CONFLICT` blocker.

### Run

- title, difficulty, loot type, scheduled start (UTC)
- status, raid lead, notes
- desired tank / healer / DPS counts
- `signupsOpen`
- **Authoritative multi-raid contents:** ordered `RunRaidContent` rows (`Run.contents`) — each row is one real raid instance with its own `plannedBossCount` / boss total. Product labels and UI content summaries are projected from these rows (`projectRunContentDisplay`). The detailed summary lists each raid (`Tide 1/1 · The Venomous Abyss 8/8`); compact title / Discord channel coverage for Bundle sums planned and total bosses (`9/9` / `9of9`).
- **No singular Run raid mirror:** `Run.raidId` and `Run.plannedBossCount` have been removed. Missing `RunRaidContent` is an invariant violation.

Create selects a persisted, active and selectable `Product` (`productId` plus optional per-content boss counts), which expands into ordered contents at create/edit time. Products are managed in the Raid Catalog. `RunTemplate` (Run Setup) stores its own ordered `RunTemplateRaidContent` rows, mirroring `RunRaidContent`, and has no singular raid column.

#### Derived title (no manual title entry)

`Run.title` is **server-derived, never client-authored**. Run creation and Edit Run have no title input — they show a read-only "Generated title" preview that live-updates as the schedule/difficulty/lootType/content coverage/raidLead change, computed client-side with the same pure `buildRunTitle` helper (`src/lib/run-title.ts`) the server uses. Coverage comes from persisted contents (`titleCoverage`: e.g. `8/8` or Bundle `9/9`). `createManyRuns` (via `prepareRunDraft`, per row) and `updateRun` always recompute and persist the title server-side from the final normalized values — a client-sent `title` is never accepted.

Format: `{weekday} {HH:mm} {difficulty} {runType} {titleCoverage} {raidLead}` in the Europe/Berlin community timezone — e.g. `Thu 21:00 HC VIP 8/8 Lead`, `Fri 20:15 Mythic Community 8/8 Lead`, or `Thu 21:00 HC Unsaved 9/9 Lead` (Season 2 Bundle). Difficulty display tokens are `NM` / `HC` / `Mythic` (never `MY`); run-type labels are `Saved` / `Unsaved` / `VIP` / `Community`. The persisted field remains `lootType` for backward compatibility. Raid Lead is the Raid Lead's `User.name` — the player name resolved from Discord (see **Player names** under User). The title follows that name while the Run has not ended: it is generated on create / edit / Raid Lead change, and a Discord name refresh that changes the name re-titles that Raid Lead's DRAFT / OPEN / ROSTERING / PUBLISHED (non-archived) Runs (`runService.retitleActiveRunsForRaidLead`). Started, completed, cancelled and archived Runs keep their historical title. Account surfaces (profile, user management, audit events) keep `User.name`.

Historical Runs are **not** retroactively retitled — their `title` stays whatever it already was until the Run is next edited (which always regenerates it). Content identity always comes from persisted `RunRaidContent`, never from regenerating commercial presets.

#### RunLootType (product: Run type)

`SAVED` \| `UNSAVED` \| `VIP` \| `COMMUNITY` — independent of `RaidDifficulty`, not a combined enum. The database column and TypeScript field stay named `lootType` / `RunLootType`; Create/Edit UI labels this selector **Run type**. **Compatibility is a Service-layer rule, not a schema constraint**: every difficulty allows every value except `MYTHIC + SAVED`, which is rejected everywhere (Create, Edit, Mass Create, templates, and Discord naming) via one central helper, `isLootTypeAllowedForDifficulty` / `assertValidRunLootType` in `src/domain/run-state.ts` (throwing `RUN_LOOT_TYPE_INVALID`). `COMMUNITY` is valid for Normal, Heroic, and Mythic. New Runs default to `UNSAVED` — valid for every difficulty including Mythic, so the default never needs a client-side override. The Create/Edit UI disables the `SAVED` option and auto-switches to `UNSAVED` when the selected difficulty is Mythic.

#### Planned boss count (per content)

Each `RunRaidContent.plannedBossCount` must satisfy `1 <= plannedBossCount <= <that content raid's total boss count>` (validated by `assertValidPlannedBossCount`, throwing `RUN_BOSS_COUNT_INVALID`). Per-content counts of a Product are FIXED or VARIABLE (`ProductBossCountMode`).

#### Historical raid availability

A raid is never deleted when superseded — `RaidRecord.availableForRuns` (catalog: `WowRaidCatalogEntry.availableForRuns`, persisted on the existing `Raid.isActive` column, no separate column) controls only whether it can be picked for a **new** Run, independent of `currentForLockouts` (the separate Blizzard lockout-derivation target). `createManyRuns` (the one canonical creation path, 1–25 rows) rejects an unavailable raid with `RAID_NOT_AVAILABLE_FOR_RUNS` for any row; `updateRun` only enforces this when the raid is actually changing to a different one — keeping an existing (possibly historical) raid, including a difficulty-only change, is never blocked. See [Historical raid availability](#historical-raid-availability) for the full detail.

#### Model: Discord channel naming

Discord run-channel names are derived from structured Run fields — never parsed from `Run.title` — via `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`): `{weekday}-{HHMM}-{difficulty}-{runType}-{coverage}-{raidLead}`, e.g. `thu-2100-hc-vip-8of8-lead` or `fri-2015-mythic-com-8of8-lead`.

Difficulty Discord tokens: `nm` / `hc` / `mythic` (never `my`). Run-type Discord tokens come from `RUN_LOOT_TYPE_CHANNEL_TOKENS`: `saved` / `unsaved` / `vip` / `com` (Community is never `community`).

Coverage comes from `contentDisplay.channelCoverage` (same projection as titles):

- single Venomous: `8of8` / `6of8`
- Season 2 Bundle: `9of9` / `7of9` (Tide + Venomous planned/total summed) — no `s2b-` prefix

Difficulty and run type are always separate hyphenated segments (`hc-vip`, `mythic-com`, never `hcvip`). Any change to a naming-source field renames the Run's existing Discord channel in place (same channel ID).

Run statuses:

| Status | Meaning |
| --- | --- |
| `DRAFT` | Lead is preparing the run. Not an open signup. |
| `OPEN` | Signups may be accepted when `signupsOpen` is true. |
| `ROSTERING` | Lead is selecting. Signups may still be open or closed independently. |
| `PUBLISHED` | Roster is published. Signups may still be open when `signupsOpen` is true — publishing does not close registration. |
| `IN_PROGRESS` | The run is happening. Signups are frozen (`signupsOpen = false`). |
| `COMPLETED` | Finished. |
| `CANCELLED` | Will not happen until Reactivate restores a snapshotted pre-start state. |

`signupsOpen` is independent of status. Run Management creates drafts, opens runs, toggles the signup window, cancels, and reactivates. Roster Management owns `OPEN → ROSTERING` and publish to `PUBLISHED`. Start/complete owns `PUBLISHED → IN_PROGRESS → COMPLETED`. Cancel before Start is reversible via **Reactivate Run** (exact prior status + `signupsOpen`); Archive is a separate visibility operation. `DRAFT` is management-only; ordinary users do not discover it. See [Run management](#run-management) and [Run lifecycle and attendance](#run-lifecycle-and-attendance).

### RunSignup

Participation on a specific run. Identity where multiplicity matters is `RunSignup.id`.

A User may simultaneously hold:

- BOOSTER participation (Character-backed offer set), and
- zero to N LOOTBUDDY participations on the **same** Run

- participation type: `BOOSTER` \| `LOOTBUDDY`
- character: **required for BOOSTER**; **null for new LOOTBUDDY** (legacy Character-backed Lootbuddy rows remain valid)
- `lootbuddyClass` (`WowClass?`) — required for new characterless Lootbuddy; display fallback `lootbuddyClass ?? character?.wowClass`
- booster role and `isBackup` (backup is not a status)
- lootbuddy `lootbuddyMode`: `LOOT_ONLY` \| `PLAYING`
- lootbuddy `lootbuddyVerification`: `NONE` \| `ACCESS` \| `TRIAL` (metadata, not an approval workflow)
- status: `PENDING` \| `SELECTED` \| `NOT_SELECTED` \| `WITHDRAWN`

Player-created signups start as `PENDING`. `SELECTED` / `NOT_SELECTED` remain roster outcomes.

Duplicate BOOSTER rows are prevented per run + user + character + participation type. Multiple characterless LOOTBUDDY rows (null `characterId`) are allowed.

Signup counts on run lists exclude `WITHDRAWN`.

See [Run signups](#run-signups) and [Canonical Run detail](#canonical-run-detail).

### RunRoster / RunRosterEntry

One roster document per run. Draft selection lives in `RunRosterEntry` and is independent of `RunSignup.status` until Publish.

- `RunRoster.runId` unique
- `state`: `DRAFT` until first publish, then `PUBLISHED` (including while a replacement draft is edited)
- `version` for stale-write protection
- `publishedAt` / `publishedById` after a successful publish
- `RunRosterEntry` unique on `(rosterId, signupId)`; rows are currently selected draft members

At most one **SELECTED BOOSTER** per User is enforced in roster validation. Multiple LOOTBUDDY selections for the same User are allowed. Characterless Lootbuddy candidates are not treated as inactive merely because they have no Character.

See [Roster management](#roster-management).

### RunAttendance

One attendance row per published selected `RunRosterEntry` for a started Run.

- unique on `rosterEntryId`
- status: `UNMARKED` \| `PRESENT` \| `LATE` \| `LEFT_EARLY` \| `NO_SHOW` \| `EXCUSED` \| `STANDBY`
- optional manager note, `markedAt` / `markedById`

Created when a published Run starts. See [Run lifecycle and attendance](#run-lifecycle-and-attendance).

### RunConsumableAudit

Post-run Warcraft Logs Consumables Audit snapshot, one per Run (`runId` unique), with `RunConsumableAuditFight`, `RunConsumableAuditPlayer` and `RunConsumableAuditObservation` children. Built only from the Run's ASSIGNED fights. Stores normalized facts only (flask aura at pull, potion/Healthstone casts, deaths per fight); PASS/WARNING/N/A is evaluated at read time. Replaced atomically on each successful analysis. ADMIN / the Run's RAID_LEAD only.

### WarcraftLogsReport / RunWarcraftLogsReport / RunWarcraftLogsFight

A Warcraft Logs report is a shared external resource (`code` unique): one report may hold several consecutive Runs, and a Run may use several reports. `RunWarcraftLogsReport` links a Run to a report; `RunWarcraftLogsFight` records each candidate fight for that Run with status `ASSIGNED` | `NEEDS_REVIEW` | `IGNORED` and decision `AUTO` | `MANUAL`. A `(report, fight)` is ASSIGNED to at most one Run (partial unique index). Matching uses the Run's active window `RunStartSnapshot.startedAt` → `Run.completedAt` (set on completion). See [Run Consumables Audit](#run-consumables-audit).

### No financial domain

BoostingHub does not pay boosters: there is no settlement, payout, share or payment model. The former `RunSettlement` / `RunPayoutEntry` tables were dropped (migration `20261009T1352_remove_payout_settlement`). `RunAttendance.status` is the attendance authority.

### Strike

Disciplinary history record against a **User** (never a Character). Optional `runId`, proven against BoostingHub's own signup history — never derived from `RunAttendance` (strikes stay manual; attendance is a separate Run lifecycle feature). Status `ACTIVE` \| `REVOKED`; no severity, no expiry, no hard delete — revocation is the only correction path and always requires a reason. See [User strikes](#user-strikes).

### RunDiscordPost

Presentation-only Discord message identity for one Run — never a second source of truth for Run/Signup/Roster data. One row per Run (`runId` unique): the signup embed's channel/message id and a cheap signature to detect drift, and the roster embed's channel/message id, last-posted `RunRoster.version` and the Guild emoji fingerprint it was rendered with. Lets the bot edit its own prior message instead of reposting, and survives a bot restart. See [Discord bot](#discord-bot).

### ActivityEvent

Development/operational activity feed for the dashboard. Not a KPI warehouse.

### Other models

The sections above cover the core rules. `src/prisma/contract.prisma` is authoritative for every field. Further models by area:

| Area | Models |
| --- | --- |
| Better Auth | `Session`, `Account`, `Verification` |
| Characters | `CharacterPlayableSpec`, `CharacterOffspecRole`, `CharacterWclPerformance`, `CharacterAvailabilityBlock`, `CharacterWeeklyUnavailability` |
| Planning | `Product`, `ProductRaidContent`, `RunRaidContent`, `RunTemplate`, `RunTemplateRaidContent`, `CommunityScheduleSlot`, `CommunityScheduleRun` |
| Run execution | `RunStartSnapshot`, `RunExternalBooster`, `RunSignupRole`, `RunRosterBossException`, `RunDomainEvent` |
| Notifications and Discord | `UserNotification`, `RunDiscordAnnouncement`, `DiscordSchedulePost`, `DiscordGlobalAnnouncement`, `DiscordChannelScanCursor` |
| Warcraft Logs | `WarcraftLogsReportDiscovery`, `RunConsumableAuditGearItem` |
| Operations | `IntegrationEvent` (health events shown on `/manage/system`) |

### Prisma 8

BoostingHub uses Prisma ORM 8 in its release-candidate line with a contract instead of a generated Prisma 7 client:

| File | Purpose |
| --- | --- |
| `src/prisma/contract.prisma` | The data contract; edit models here |
| `src/prisma/contract.json`, `src/prisma/contract.d.ts` | Generated by `npm run db:emit`; committed |
| `prisma.config.ts` | CLI configuration, reads `DATABASE_URL` through `dotenv` |
| `src/lib/prisma.ts`, `src/lib/pg-pool.ts` | Runtime client and the one shared `pg.Pool` |

### Prisma 8 workflow

1. Edit `src/prisma/contract.prisma`
2. `npm run db:emit` (replaces Prisma 7 `generate`)
3. `npx prisma migration plan --name change_name`
4. `npm run db:migrate`
5. Update seed/docs if domain behavior changed

`npm run db:verify` checks the live database against the emitted contract. `npm run db:status` lists applied / pending migrations for DATABASE_URL.

#### Schema check before `npm run dev`

`npm run dev` first runs a **read-only** check (`predev` → `scripts/check-dev-db-schema.ts`) that the database in DATABASE_URL is on the committed migration history and current. It prints which database it checked (host/port/name only) and stops with an explicit instruction instead of letting the app fail later with `SqlQueryError: column … does not exist`:

- **behind** (pending migrations) → `npm run db:migrate`
- **not reachable** → start Postgres / check DATABASE_URL
- **off the migration history** → see below

It never migrates, signs or resets anything. `SKIP_DEV_DB_SCHEMA_CHECK=1 npm run dev` bypasses it (it then says the database is unverified). Deployment (`deploy/update-server.sh` runs `db:migrate` itself) and the automated-test database (`npm run test:db:reset`) are unaffected.

**Only apply committed migrations to the shared development database.** Plan and try a branch's migration on an isolated database (a fresh `*_test_*` database, migrated + seeded), not on DATABASE_URL: if the branch is rebased and its migration re-planned, the shared database is left on a contract hash that is not in the committed graph.

#### Development database off the migration history

`MIGRATION.MARKER_NOT_IN_HISTORY` means the database's marker is a hash no committed migration produces — typically a branch's draft migration that was later re-planned. `db migrate` cannot walk from there, and **`prisma db update` is the wrong fix**: it diffs tables and would skip the committed migrations' data steps (e.g. `20260927T1408_boosting_roles_on_user` carries BoosterQualification approvals into `User.isBooster`).

Recover by putting the marker back on the committed chain, then migrating normally:

1. Back up the database (`pg_dump --format=custom`).
2. From `prisma_contract.ledger`, find the last migration the database actually ran and compare its `operations` with the committed migration(s) that replaced it; work out which committed node the live schema equals (plus anything the draft skipped).
3. `npx prisma db sign <committed migration dir or dir^>` — verifies the live schema against that exact contract first and writes nothing if it does not match. Apply any skipped committed migration with `npx prisma db migrate --to <dir>`, and sign again where the draft already made the change.
4. `npm run db:migrate`, then `npm run db:status` (**Up to date**) and `npm run db:verify` (**marker and schema match contract**).

Queries use `db.orm.public.Model`, not Prisma 7 `prisma.model.findMany`.

### Incremental Prisma migrations

`npx prisma migration plan --name slug` can emit a full recreate if `--from` is omitted incorrectly. Plan from the previous migration directory:

```bash
npx prisma migration plan --name change_name --from <previous migration dir or hash>
```

## Tests, build and quality

There is no CI in this repository; these checks run locally before a pull request.

### Validation

```bash
npm run db:emit
npm run db:verify
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm test
npm run build
```

### Test setup

- Runner: Vitest, `tests/**/*.test.ts`, one file at a time (`fileParallelism: false`). `src/` contains no tests. A test is filed by what it does, not by its name: `tests/integration/` when it queries the database (beyond Better Auth's schema check at import) or runs a real subprocess, otherwise `tests/unit/`. Below either folder the path mirrors the module under test (`src/services/x.ts` → `tests/integration/services/x.test.ts`). Imports use `@/` for production code and `@tests/` for fixtures and helpers; a test that reads source files resolves them with `srcPath()` (`tests/helpers/repo-paths.ts`). There are no end-to-end browser tests.
- Deploy scripts have offline shell tests (`bash tests/integration/deploy/update-server.test.sh`, `bash tests/integration/deploy/production/backup-db.test.sh`, `bash tests/integration/deploy/production/env-status.test.sh`; the last two need a real `python3` on the PATH, and most checks fail without one).
- Database: `TEST_DATABASE_URL` is required and must differ from `DATABASE_URL`. `src/lib/pg-pool.ts` refuses to start under Vitest otherwise. `npm run test:db:reset` resets and reseeds that database destructively; `npm run test:full` resets, then runs everything. Set `TEST_DATABASE_EXPECTED_NAME` to pin the one database a checkout may use: the pool, Vitest's global setup and `test:db:reset` then refuse any other name before connecting.
- External APIs: `tests/setup/external-api-guard.ts` fails a test that lets a real Warcraft Logs, Blizzard or Raider.IO request escape.
- Some tests use the seeded database and mutate Roster Lab fixtures; re-seed after them if you need the original demo rows. Parallel checkouts need one test database each, because a reset would break a concurrent run.
- Discord: pure bot logic is unit-tested. The discord.js wiring (`client.ts`, the real calls in `sync-loop.ts`, `register-commands.ts`) cannot run without a live token and is verified by typecheck, build and smoke tests only.

### Discord bot test coverage

- Pure, fully unit-tested: `custom-ids.ts`, `format.ts`, `discord-channel-name.ts`'s `buildDiscordRunChannelName`, `wow-run-week.ts`'s `classifyRunWeek` (basic classification, half-open boundary equality, winter/summer, and both DST transitions — with an explicit test proving the CURRENT→NEXT gap is *not* a fixed 168 UTC hours across a transition), `discord-schedule.ts` (Schedule eligibility, CURRENT/NEXT filtering, ordering, signature convergence, empty state, format-version bump), `embeds/signup-embed.ts`, `embeds/roster-embed.ts`, `bot-api-client.ts` (mocked `fetch`, including `listSyncWork`'s `channels[]`), `env.ts`'s `loadBotEnv` (the one active category, independent marker-channel resolution, and the ARCHIVE category), `interactions/error-copy.ts`, `interactions/signup-flow.ts`'s `buildSelectOptions`/`parseSelectedOffers`, `commands/mysignups.ts`'s `formatMySignups`, `channel-reconciliation.ts`'s `reconcileExistingRunChannel`/`reconcileChannels` (CURRENT/NEXT sharing one category, ARCHIVE move, rename, missing-category, missing-channel, failure-isolation), and `reconcileWeekSectionPositions` (chronological CURRENT/NEXT ordering, manual drift correction, marker identity/name/parent never touched even though their position may appear in the payload, unmanaged channels keep their relative position, missing/invalid marker config, ARCHIVE items ignored — all against fake position lists, no discord.js or live token needed). Schedule edit-in-place / deleted-message recovery / failure isolation vs archive+signup: `sync-loop.test.ts`. Service lane: `discord-schedule-sync.test.ts`.
- Bot API routes: tested by calling the exported Route Handler functions directly with constructed `NextRequest`s (`tests/integration/app/api/bot/bot-routes.test.ts`), including a contract test asserting `GET /api/bot/discord/sync` exposes `channels` alongside `signups`/`roster`, each carrying `targetBucket` and `scheduledStartAt` — no live Discord credentials required.
- `discord-sync.service.ts`: tested against the real test database like every other Service, including channel provisioning/idempotency/rename, the independent `channels` lane, and weekly target resolution with an injectable `now` — CURRENT/NEXT eligible for first provisioning, PAST/FUTURE blocked, app archival overriding week classification, and a same-Run rollover test (NEXT → CURRENT across two `listSyncWork` calls with no Run mutation in between) (`tests/integration/services/discord-sync.service.test.ts`).
- The discord.js Client wiring itself (`client.ts`, `sync-loop.ts`'s actual channel fetch/create/message send/edit/`setPositions` calls, `register-commands.ts`) cannot be unit-tested without a live bot token — it was verified structurally (typecheck, production build, and a boot smoke test against Discord's own token validation) rather than end-to-end. `sync-loop.ts` is kept as thin as possible specifically so the real reconciliation *logic* lives in the unit-tested `channel-reconciliation.ts` instead.

## Authentication and authorization

### Discord OAuth

Primary login method. Configured through Better Auth `socialProviders.discord` when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set.

Redirect URL:

```text
http://localhost:3000/api/auth/callback/discord
```

Email is not required. Discord profile maps into display name, avatar, `discordUserId`, and `discordUsername`.

First sign-in creates a `user` row. Prisma defaults are `accountRole=USER` and `accountStatus=ACTIVE`. Role and status are server-owned (`input: false`) so OAuth cannot self-promote. ADMIN may later change `accountRole` through user management.

Trusted request handlers reload the session user with `userRepository.findAuthenticatedById`, so role changes take effect on the next request without invalidating the session cookie.

A new Discord user has no characters, signups, or roster rows. Pages must render empty states instead of assuming seed fixtures.

#### Discord Booster role sync

When `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_BOOSTER_ROLE_ID`, and `DISCORD_LOOTBUDDY_ROLE_ID` are all set, every completed sign-in reconciles Discord guild roles into `User.discordRaidBooster` / `User.discordLootbuddy` (never overwriting manual `isBooster` / `isLootbuddy`).

The sync never writes the manual flags and never blocks sign-in. An authoritative Discord answer decides the Discord-derived grants: a role the member does not hold, or HTTP 404 (not in the guild), sets that grant to `false`. A transport or other Discord API failure keeps the last known value, and incomplete configuration does nothing. Effective access is `manual ∨ Discord`, so a User who only has the Discord-derived grant loses effective Booster access at the next sign-in after losing the role, while a manual grant is unaffected. If ADMIN / OWNER revoke the manual flag of a User who still holds the configured role, the User keeps effective access through the Discord grant.

The lookup uses the server-only bot token and guild ID. It changes neither `accountRole` nor Lootbuddy access and does not create a human-admin audit event.

### Battle.net (secondary connection)

Battle.net is **not** a login provider. Discord (or a development credential identity) remains the BoostingHub session.

When `BLIZZARD_*` env vars are set, an authenticated user may connect a regional Battle.net account from `/characters` to import or link WoW characters. That OAuth flow uses dedicated routes under `/api/integrations/battlenet/*`, not Better Auth. User Battle.net tokens are never persisted. See [Battle.net integration](#battlenet-integration).

### Development authentication

Local tests and QA still need deterministic identities. Discord OAuth is the real user path.

Development login is shown only when:

- `NODE_ENV !== "production"`
- `DEV_AUTH_ENABLED === "true"`

It uses Better Auth email/password against **credential** accounts only. Discord-only users are omitted from the picker because they have no password.

The login panel is labeled as development and uses warning styling so it cannot be mistaken for Discord.

This is not a silent production bypass. Production runtime disables the credential provider and rejects the server action.

Seeded identities and `DEV_AUTH_PASSWORD` are documented in [Local development](#local-development).

### Development account bootstrap

`npm run db:seed` wipes `accountRole`/`accountStatus` and Boosting Roles for every user, including your own real Discord-linked developer account. Development account bootstrap exists solely to restore that ONE account automatically after a Discord sign-in, so re-seeding never leaves you locked out of ADMIN screens locally.

Enabled only when all of the following hold:

- `NODE_ENV !== "production"` — a code-level check, not just configuration. Even if `DEV_ACCOUNT_BOOTSTRAP_ENABLED` is accidentally left `"true"` in a deployed environment, production is a hard no-op.
- `DEV_ACCOUNT_BOOTSTRAP_ENABLED === "true"`
- `DEV_ADMIN_DISCORD_USER_ID` is set to your real Discord user ID (snowflake)

Targeting is by exact `User.discordUserId` match only — never username, display name, email, or database `User.id`. A signed-in user whose `discordUserId` doesn't match exactly is completely untouched (0 writes).

Wired as Better Auth's `databaseHooks.session.create.after` (see `src/auth/auth.ts`), which fires once per sign-in for both a brand-new User (first Discord sign-in after a DB reset) and an existing one (privileges reset by re-seeding) — there is no separate first-login code path. Discord sign-in creates/persists the `user` row first, as normal; bootstrap only ever evaluates an already-persisted User and never creates one itself.

On a match, it restores:

- `accountRole = ADMIN`, `accountStatus = ACTIVE`
- The Booster role (`User.isBooster = true`; account-level, not scoped by raid difficulty). The Lootbuddy role is left as is.

It is idempotent: an already-correct field is left untouched, including `updatedAt` (no churn on every login), and it never writes an `ActivityEvent` — normal ADMIN grant/revoke through `/manage/users/[id]` continues to log Activity; this only restores one development account's own roles as a system bootstrap rather than a human admin's action.

There is no UI, no admin endpoint, and no client-visible flag for this — `DEV_ADMIN_DISCORD_USER_ID` is server-only configuration, never exposed to the browser. See [Local development](#local-development) for setup and safe local verification.

### Session enforcement

`src/proxy.ts` redirects unauthenticated browsers away from app routes based on cookie presence. That check is not sufficient.

Controllers call:

- `requireUser()` / `requireUserOrRedirect()`
- `requireRaidLead()` / `requireManagerOrRedirect()`
- `requireAdmin()`

Management routes are enforced on the server. Users without `RAID_LEAD` or `ADMIN` are redirected to `/dashboard`.

### Account Roles

Platform permissions on `User.accountRole`:

| Role | Meaning |
| --- | --- |
| `USER` | Standard operator: characters, signups, own profile |
| `RAID_LEAD` | Create/manage assigned runs; manage hub for runs |
| `ADMIN` | All raid-lead powers plus Boosting Role grants/revokes, legacy request review, and user administration |
| `OWNER` | The protected Platform Owner: every Admin permission, and nobody can change it through role management |

Hierarchy: `OWNER` > `ADMIN` > `RAID_LEAD` > `USER` — each level inherits everything below it. Authority is always checked through `hasOwnerAccess` / `hasAdminAccess` / `hasRaidLeadAccess` (`src/auth/authorization.ts`), never with a literal role comparison, so an OWNER can use every Admin feature (users, Booster Access, Templates, every Run, Raid Lead eligibility).

`BOOSTER` and `LOOTBUDDY` are run participation types, never account roles.

### Platform Owner

There is at most one OWNER. It exists so that no ordinary Admin can take the platform away from its owner.

- **Protected.** No one — no ADMIN and not the OWNER — can change an OWNER through the generic role flow (`OWNER_ROLE_PROTECTED`). This is enforced server-side, on the locked row inside the write transaction, not by hiding controls.
- **Not assignable.** The generic role flow never assigns OWNER (`OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP`), even when a crafted request submits `nextRole=OWNER`. The **Change role** dialog only offers `MANAGEABLE_ACCOUNT_ROLES` (`USER`, `RAID_LEAD`, `ADMIN`); an OWNER's user detail shows **Platform Owner · Protected** instead of the button.
- **Singleton in the database.** A partial unique index `user_single_owner` on `user("accountRole") WHERE "accountRole" = 'OWNER'` makes a second OWNER row impossible, including under concurrent bootstraps.
- **Session freshness.** Like every role, OWNER authority comes from the per-request database reload — there is no session-only override.
- **Account status.** BoostingHub has no action that disables accounts (the only status write is the development account bootstrap, which sets `ACTIVE`), so there is no disable path to protect. The dev bootstrap keeps an OWNER as OWNER.

#### Owner bootstrap

The schema migration makes nobody OWNER — existing ADMINs stay ADMIN. The first OWNER is set explicitly, with the target named by its exact User UUID (look it up on `/manage/users/<id>`):

```bash
npm run owner:bootstrap -- --user-id <uuid>
```

On production run it as the app user from the release directory (`cd /var/www/boostinghub && sudo -u boostinghub npm run owner:bootstrap -- --user-id <uuid>`). In one transaction it requires that the User exists, is `ACTIVE` and is `ADMIN`, and that no OWNER exists yet; then it sets `OWNER` and writes an `ActivityEvent` `PLATFORM_OWNER_BOOTSTRAPPED` (`targetUserId`, name, previous role, new role). Any later run fails with `OWNER_ALREADY_EXISTS` — also for the same user — and changes nothing. There is no web UI for it, and a manual SQL update is not a supported procedure.

**Ownership transfer is intentionally out of scope.** A future, dedicated transfer workflow can be built separately; until then ownership cannot move through any normal flow.

### Last Admin

The platform must keep at least one **active Admin-level account** — an ADMIN or the OWNER. Removing the last one throws `LAST_ADMIN_REQUIRED`:

- with an active OWNER, the last literal ADMIN may be demoted;
- before an OWNER is bootstrapped, the last active ADMIN stays protected;
- a DISABLED Admin does not count.

The check runs inside the write transaction (`userRepository.changeAccountRoleAtomic`): when a change removes Admin-level authority, every Admin-level row plus the target is row-locked first, then the remaining active Admin-level accounts are counted. Two concurrent demotions therefore serialize — they can never both pass and leave the platform without an Admin.

### Active Run Safety

Demoting an account that currently has raid-lead access (`RAID_LEAD` or `ADMIN`) to a role without it (`USER`) is blocked while that user is `raidLeadId` on any non-terminal run (`DRAFT`, `OPEN`, `ROSTERING`, `PUBLISHED`, `IN_PROGRESS`).

Error: `ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS`.

`COMPLETED` and `CANCELLED` runs do not block.

### Session Role Freshness

Trusted controllers load the session user with `userRepository.findAuthenticatedById`. That read returns current `User.accountRole` from the database on each request. Role changes therefore apply without session cookie invalidation or forced re-login.

## Feature rules

Ordered from accounts and Characters, through planning and the life of a Run, to messaging and operations.

### Application shell

#### User flow

1. Sign in at `/` with Discord or a development identity.
2. Land on `/dashboard`. The dashboard's **Recent Activity** (community-wide operational events) is shown to raid leads and admins only; regular users never receive those events.
3. Move between Runs, My Runs, Characters, Profile, Settings. Open a Run from those lists at `/runs/[runId]`.
4. On mobile widths (`md` and below), open the header menu for an off-canvas left drawer (Main + Management). Desktop keeps the persistent SideNav. There is no mobile bottom navigation.
5. Raid leads and admins also see Manage, with a role-based sub-nav (Overview / Runs / Schedule; ADMIN also Users / Characters / Raid Catalog / Analytics / System).

#### Shell permissions

- All app routes: authenticated `ACTIVE` user
- `/manage*`: `RAID_LEAD` or `ADMIN`, enforced in controllers
- `/manage/users` (All Users + Pending Boosting Access; old `/manage/boosting-roles` and `/manage/booster-access` redirect here): `ADMIN` only

### User management

#### Users: Purpose

Give ADMIN operators a management hub for browsing accounts, inspecting characters, managing Boosting Roles, and assigning platform account roles (`USER`, `RAID_LEAD`, `ADMIN`). Role changes are server-owned and audited.

This feature does **not** turn Booster or Lootbuddy into account roles. They are Boosting Roles on the User (`isBooster`, `isLootbuddy`), independent of the account role and of each other; Booster is not scoped by raid difficulty. See [Boosting Roles](#boosting-roles).

#### Management Hub

`/manage` is the operations overview for RAID_LEAD and ADMIN.

- RAID_LEAD sees run metrics and the Runs entry point.
- ADMIN additionally sees a Users card with compact counts.

Metrics are prepared by `managementHubService`. Views render cards only; they do not query Prisma.

#### Navigation

`getManagementNavItems(accountRole)` drives the manage sub-nav in the app shell:

| Role | Modules |
| --- | --- |
| USER | none (no Manage entry) |
| RAID_LEAD | Overview, Runs, Schedule |
| ADMIN / OWNER | Overview, Runs, Schedule, Users, Characters, Raid Catalog, Analytics, System |

Hidden links are not authorization. Controllers still call `requireManagerOrRedirect`, `requireAdmin`, and service asserts.

`isManagementNavActive` treats `/manage` as exact-match only so `/manage/users` does not highlight Overview.

Characters across all users (sync health, linkage, lockouts, admin sync controls) live in [Character Operations](#character-operations) (`/manage/characters`). `/manage/analytics` (operational analytics, `operationalAnalyticsService`) and `/manage/system` (integration health and recent `IntegrationEvent` rows, `systemHealthService`) are ADMIN / OWNER only.

#### User Listing

Route: `/manage/users` (ADMIN only).

Lists accounts with role, Discord identity hints, character counts, and the account-level booster state (Approved / Revoked / None). Filters/sorts are applied in `userRepository.listAdminUsers` via `userManagementService.listUsers`.

#### User Detail

Route: `/manage/users/[userId]`.

Shows identity, account role/status, characters, the account-level booster state (Grant when not approved, Revoke when approved), disciplinary Strike history (Add/Revoke), and recent audit events relevant to that user (including `ACCOUNT_ROLE_CHANGED` events authored by another admin that mention `targetUserId=`).

Strikes are a separate concept from account role, Boosting Roles, and audit — see [User strikes](#user-strikes).

#### Role Administration

ADMIN changes roles through `userManagementService.changeAccountRole`.

Supported transitions include USER → RAID_LEAD, RAID_LEAD → ADMIN, and ADMIN → RAID_LEAD / USER (when another Admin-level account remains). An ADMIN may still change another ADMIN; only the OWNER is protected (see Platform Owner). Same-role assignments throw `ROLE_ALREADY_ASSIGNED`. Unknown values throw `INVALID_ACCOUNT_ROLE`.

Clients cannot invent roles outside `ACCOUNT_ROLES`, and OWNER is never accepted as a target role.

#### Users: Audit

Successful role changes create an `ActivityEvent`:

- `type`: `ACCOUNT_ROLE_CHANGED`
- `userId`: acting admin
- `message`: includes previous/next role labels and `targetUserId=<id>`

User detail surfaces those events for the target account.

#### Users: Authorization

| Actor | List / detail users | Change account role | Manage nav users link |
| --- | --- | --- | --- |
| USER | no | no | no |
| RAID_LEAD | no | no | no |
| ADMIN | yes | yes, except the OWNER and except assigning OWNER | yes |
| OWNER | yes | yes, except itself and except assigning OWNER | yes |

Service gate: `assertCanManageUsers` → `USER_MANAGEMENT_FORBIDDEN`.

Controller: `requireAdmin` on role-change actions. Pages use admin redirects.

#### Users: MVCS

- Model: `User.accountRole`, `ActivityEvent`
- View: manage hub cards, `/manage/users`, user detail, change-role dialog
- Controller: `user-management.actions.ts`, app/management controllers for page data
- Service: `userManagementService`, `managementHubService`
- Repository: `userRepository` (list/detail/count/update role/non-terminal runs), `activityRepository`

#### Users: Security

- Role mutations require ADMIN session; target role validated server-side
- Last-admin and active-run guards run in the service before persist
- OAuth / clients cannot set `accountRole` (`input: false` on the auth user model)
- Audit messages identify actor and target without exposing secrets
- Navigation hiding is presentation only; every mutation re-checks authorization

### Boosting Roles

#### Boosting Roles: Purpose

Let an ADMIN (or the OWNER) grant and revoke a User's **Boosting Roles** after Discord review. A configured Discord guild role may also grant Booster automatically when the User signs in.

#### Account role vs Boosting Roles

Two independent concepts live on the User:

| Concept | Values | Controls |
| --- | --- | --- |
| **Account role** (`User.accountRole`) | `USER` · `RAID_LEAD` · `ADMIN` · `OWNER` | Platform authorization — what a User may manage |
| **Boosting Roles** (`User.isBooster`, `User.isLootbuddy`) | Booster · Lootbuddy (each on/off) | Operational participation |

A User may hold zero, one or both Boosting Roles, independently of the account role and of each other — `USER + Booster`, `USER + Lootbuddy`, `ADMIN + Booster`, `OWNER + Booster + Lootbuddy` are all valid. Booster and Lootbuddy are **never** account roles, and they are **never** stored on a Character. ADMIN / OWNER do not receive a Boosting Role automatically.

Run participation (`RunSignup.participationType` = `BOOSTER` / `LOOTBUDDY`) is still chosen per signup; the Boosting Roles are account-level capabilities.

#### Boosting Roles: Booster

`User.isBooster = true` means the User is approved to sign up and be rostered as a Booster.

**The Booster role is not scoped by raid difficulty.** An approved Booster may boost Normal, Heroic and Mythic Runs alike. **Run difficulty remains relevant** everywhere else — Runs, raid contents, lockouts, weekly availability, signup display, rosters, Discord run posts and history — it is simply not part of the Booster question.

The single check is `isApprovedBooster(...)` / `hasEffectiveBoosterAccess(...)` in `src/domain/boosting-access.ts` (manual `isBooster` ∨ Discord `discordRaidBooster`). It does not depend on Character, WoW Class, specialization, Character Role, Item Level, account role, Lootbuddy, or Raid Difficulty.

| Concern | Question |
| --- | --- |
| Booster role | Is this User an approved Booster? |
| Character eligibility | May this Character be used in this Run? |
| Roster composition | Do we want this Character/role on the roster? |

Signup options and roster revalidation read the signup owner's `isBooster` only (hydrated onto Character / roster rows as `ownerIsBooster`). Character ownership, active state, valid role-for-class, weekly availability, cross-Run reservation, lockouts (informational), run/signup state and composition rules are separate and unchanged. A non-Booster is rejected with `NO_BOOSTER_ACCESS` (options) / `BOOSTER_ACCESS_REQUIRED` (signup) on every difficulty; there is no difficulty-specific rejection. Revoking the role takes effect immediately: the owner's roster rows show "Owner no longer has the Booster role." and block publish until resolved; existing signups and history stay.

#### Boosting Roles: Lootbuddy

`User.isLootbuddy = true` marks the User as a recognised Lootbuddy. Today it is a **management and display capability only**:

- Lootbuddy signups (characterless `RunSignup` rows with class / mode / verification) are open to every User and are **not** gated by `isLootbuddy` — there was no Lootbuddy eligibility gate before, and none was invented.
- Existing Users start with `isLootbuddy = false`; there was no authoritative source to derive it from.

#### Managing the roles

ADMIN / OWNER (`canManageBoostingRoles`) retain the manual controls through the explicit operation `boostingRoleService.setRole(admin, { userId, role: "BOOSTER" | "LOOTBUDDY", enabled, reason? })` (server action `setBoostingRoleAction`). The raw booleans are never accepted by a generic User update. Setting a role to the state it already has is a no-op (no write, no audit event).

Additionally, when `DISCORD_BOOSTER_ROLE_ID` and `DISCORD_LOOTBUDDY_ROLE_ID` are configured alongside the bot token and guild ID, a Discord sign-in reconciles Discord-derived grants into `User.discordRaidBooster` / `User.discordLootbuddy`. These are independent of the manual flags: Discord never overwrites `isBooster` / `isLootbuddy`. Effective Booster access is `manual ∨ Discord Raid Booster`; effective Lootbuddy access is `manual ∨ Discord Lootbuddy`. Authoritative role absence, guild departure, or Discord unlink clears only the Discord-derived grants. Transient Discord API failures preserve last-known Discord grants. M+ Booster and staff/ping roles never grant either access.

Surfaces:

- **`/manage/users`** — canonical Admin surface: **All Users** (directory with platform role, account status, booster status, pending counts) and **Pending Boosting Access** (historical PENDING requests grouped by user). Filters include search, account status, platform role, booster status, and pending access.
- **`/manage/users/[id]`** — primary grant/revoke place: **Boosting access** with Booster / Lootbuddy Grant·Revoke plus any pending historical requests for that user. No difficulty selector on the role itself.
- **Legacy URLs** — `/manage/boosting-roles` and `/manage/booster-access` redirect into `/manage/users` (legacy/pending query → `?view=boosting-access`).
- **Management hub** — single **Users** card: totals, boosters, and pending access (no separate Boosting Roles card).

Audit: every change writes an `ActivityEvent` under the acting admin — `BOOSTER_GRANTED`, `BOOSTER_REVOKED`, `LOOTBUDDY_GRANTED`, `LOOTBUDDY_REVOKED` — with a `targetUserId=<id>` marker so it also appears in the target's audit trail on `/manage/users/[id]`. No difficulty is recorded.

Onboarding:

```text
User → Apply via Discord → staff review → ADMIN grants Booster manually or staff assigns the configured Discord role → next Discord sign-in grants Booster
```

Self-service in-app requests stay disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`). User-facing pages show an **Apply via Discord** CTA when `DISCORD_BOOSTER_TICKET_URL` is set. A User may receive the Booster role with zero Characters.

#### User-facing display

- **Profile** — a **Boosting roles** card showing only the enabled roles (e.g. `Booster` `Lootbuddy`), or "No boosting role yet".
- **`/characters`** — one **Your boosting roles** line for the account (not repeated per Character), with the Discord CTA when not a Booster.
- **Character detail** — a compact **Booster signups** note: the Booster role belongs to the account and covers every difficulty.
- **`/manage/characters/[id]`** — the owner's Boosting Roles, read-only.

Never shown: `Booster · Normal / Heroic / Mythic` — the Booster role has no difficulty.

#### HISTORICAL REQUEST vs CURRENT CAPABILITY

| | Model | Meaning |
| --- | --- | --- |
| Historical request | `BoosterAccess` | What was requested at the time (User + Class + Role + Difficulty, optional Character context), `PENDING` / `APPROVED` / `REJECTED` / `REVOKED` |
| Current capability | `User.isBooster` | Whether the User is an approved Booster **now** |

`BoosterAccess` rows are preserved as history and are **never read for eligibility**; nothing in current eligibility depends on them.

**Pending Boosting Access · N** (`/manage/users?view=boosting-access`) lists unresolved historical `PENDING` rows (grouped by user), filterable by requested difficulty and role:

- **Approve** marks that row and every other PENDING row of the same User `APPROVED` (their recorded difficulty is kept) and grants the account-level Booster role (a no-op if the User already has it).
- **Reject** marks the row `REJECTED`; it never changes Boosting Roles. Reviewed rows are never rewritten by a later approval.

#### Boosting Roles: Migration

`20260927T1408_boosting_roles_on_user` upgrades directly from the production schema, where `BoosterQualification` was one row per (User, Difficulty):

1. adds `user.isBooster` / `user.isLootbuddy` (`NOT NULL DEFAULT false`);
2. sets `isBooster = true` for every User with **any** `APPROVED` qualification row, whatever its difficulty (Normal, Heroic, Mythic, several, or approved + revoked). Users with only `REVOKED` rows, or none, stay `false` — no approved booster loses access;
3. drops `booster_qualification`.

`isLootbuddy` stays `false` for everyone. `booster_access` is not touched. The migration is covered by `tests/integration/prisma/boosting-roles-migration.test.ts`.

#### Out of scope here

Automatic revocation from Discord, mass signup, Strikes, Deducts, Lootbuddy eligibility rules, difficulty-specific booster permissions.

### User strikes

#### Strikes: Purpose

A disciplinary history record against a `User`. This is BoostingHub-owned internal administration, independent of Run operations.

BoostingHub owns Users (with their Boosting Roles), Characters, Runs, Signups, Rosters, Run attendance, and this Strike history. Strike is intentionally uncoupled from attendance — it has no relation to `RunAttendance` (no auto-strike from No-show / Late).

Nothing here is automatic: every Strike is an explicit staff action. There is no automatic sanction, no automatic expiry, and no severity scoring.

#### Strikes: Model

`Strike`: `userId` (subject, required), `runId` (nullable), `reason` (required), `notes` (optional, staff-only), `status` (`ACTIVE` \| `REVOKED`), `createdById`, `revokedAt` / `revokedById` / `revokedReason`, timestamps.

Subject is always `User`, never `Character` — a Strike survives account role changes, Character deactivation, and Boosting Role changes. No severity. No expiry (`expiresAt` is explicitly not implemented; "active" means `status === ACTIVE`, permanently, until an ADMIN revokes it). No hard delete — revocation is the only correction path and keeps the row, so history is never lost.

#### Run relation

`runId` is optional: most Strikes reference the Run an incident happened on, but ADMIN may also record a general disciplinary note with no Run context (e.g. a pattern of behavior not tied to one run).

Run association is proven using **BoostingHub's own signup history** (`RunSignup`) — never Attendance, which this feature does not read or write.

#### Strikes: Authorization

| Action | ADMIN | RAID_LEAD | USER |
| --- | --- | --- | --- |
| Create (no `runId`) | yes | no (`STRIKE_RUN_REQUIRED`) | no |
| Create (with `runId`) | yes, any Run | only a Run they manage (`canManageRun`), and only for a User with signup history on it (`STRIKE_USER_NOT_ASSOCIATED` otherwise) | no |
| Revoke | yes | no (`STRIKE_REVOKE_FORBIDDEN`, even for a Strike they created) | no |
| Read own history | n/a | n/a | yes (no internal `notes`) |
| Read another User's history | yes | only via a Run they manage | no |

#### Strikes: Visibility

- ADMIN sees full detail: reason, internal notes, linked Run, creator, revoke metadata.
- USER sees their own complete history (active and revoked): reason, linked Run, date, status, revoke reason. Internal `notes` are never shown to the User, even for their own Strikes.

#### Strikes: UI

- `/manage/users/[userId]`: **Strikes** card (between Boosting roles / Characters and Audit) — full detail, Add strike (general, ADMIN), Revoke (ADMIN-only, reason required).
- `/profile`: read-only Strikes card — own history, no internal notes.
- Run-linked strikes: `AddStrikeButton` sits in the manager signup list and derives `runId`/`userId` from BoostingHub's own signup row. **The current Run page does not render that list for managers** (see [HANDOVER.md](HANDOVER.md#known-bugs-and-limitations)), so in practice Strikes are added on the user page. Marking any Attendance status never creates a Strike.

No dedicated `/manage/strikes` page exists.

#### Activity / Audit

`STRIKE_ADDED` and `STRIKE_REVOKED` follow the existing `ActivityEvent` convention: `userId` is the acting staff member, and the free-text `message` embeds `targetUserId=`/`strikeId=` (and the Run title when linked). Internal notes are never included in the audit message.

#### Strikes: MVCS

- Model: `Strike`
- View: Strikes card (`/manage/users/[userId]`, `/profile`), Signups-tab Add-strike action
- Controller: `strike.actions.ts`
- Service: `strike.service.ts`
- Repository: `strike.repository.ts`

#### Strikes: Deferred

Strike expiry/decay, severity levels, appeals workflow, automatic sanctions (including any automatic Strike-from-attendance-status or Booster-role-revoke-from-strike-count), a dedicated `/manage/strikes` review page, Discord synchronization, automated bot enforcement, and any financial deduction (BoostingHub has no financial domain).

### Character management

#### Characters: Purpose

Let an authenticated user create and manage their own World of Warcraft characters without requiring seed data.

Add Character resolves Class and Item Level from Blizzard's public Character Profile. The owner pastes one or more Raider.IO profile links (1–10; the link is only parsed, Raider.IO is not called for this) and chooses a specialization. Canonical name and realm come from Blizzard, never from the link. Optional Battle.net account integration (OAuth-backed, ownership-verified) enriches the **same** Character rows (import, link, item-level refresh). It does not introduce a second character model. See [Battle.net integration](#battlenet-integration).

#### Ownership

A Character belongs to exactly one User.

All mutations take the owner from the authenticated session. Submitted `userId` is ignored.

Users cannot view details, edit, deactivate, reactivate or delete another account's characters. ADMIN does not bypass this self-service ownership here; admin deletion lives in Character Operations (`/manage/characters`).

Hidden UI is not authorization. Controllers call `CharacterService`, which loads the row and asserts `character.userId === session.user.id`.

#### Character identity

Logical identity is owner-scoped:

- region
- realm
- character name

Display values keep the spelling the operator entered (after trim / realm whitespace collapse).

Duplicate detection uses canonical tokens:

- `normalizedName`
- `normalizedRealm`

Normalization is Unicode NFKC, trim, collapse internal whitespace, then case-fold with `en-US`. It is **not** accent-stripping: `Éowyn` and `Eowyn` stay different.

The database enforces uniqueness on:

`(userId, region, normalizedRealm, normalizedName)`

The same name may exist on another realm, another region, or another user's account.

Conflicts map to `CHARACTER_ALREADY_EXISTS`, not a raw unique-constraint error.

When linked, Blizzard identity is additionally scoped as `(region, blizzardRealmId, blizzardCharacterId)`.

#### Class / specialization / role

`WowClass` is an enum. The UI offers only catalog classes.

Specialization is a catalog string per class (for example Restoration Shaman, Protection Warrior). The server rejects combinations that are not in `src/lib/wow-specializations.ts`.

`primaryRole` is **derived** from the primary specialization as a concrete roster role (`TANK` / `HEALER` / `MELEE_DPS` / `RANGED_DPS`). Historic rows may still show generic `DPS`.

**Playable specializations** (`CharacterPlayableSpec`, additional specs beyond primary) are the authoritative capability set. Signup offered roles are the unique `rosterRoleForSpecialization` values over primary + playable specs. A Restoration Shaman can offer Healer only until Elemental or Enhancement is configured as playable — class-wide role lists are never used for signup eligibility.

Booster approval is account-level `User.isBooster` (not role-scoped `BoosterAccess`). Capability ∩ approval is: configured concrete roles when `isBooster`, otherwise none.

On Battle.net import, Blizzard active specialization is a **prefill only**. After create, specialization and playable specs stay BoostingHub-owned; Refresh does not overwrite them.

##### Class edit policy

Class is **immutable after creation**.

Changing class while historical signups and playable-spec capability still point at the old class would corrupt eligibility history. Operators create a new character instead of editing class. Linked Refresh refuses if Blizzard reports a different class.

#### Active lifecycle

New characters start `isActive = true`.

**Deactivate** sets `isActive = false`. It does not delete the row.

**Reactivate** sets `isActive = true`. It does not grant the Booster role, clear lockouts, or rewrite signups.

Inactive characters are excluded from **new** BOOSTER signup eligibility. New LOOTBUDDY signups are characterless (Class + Mode) and do not use Character eligibility. Historical My Runs and roster rows stay visible.

Deactivating a character that already has future PENDING/SELECTED signups does **not** auto-withdraw those rows. That needs an explicit later lifecycle policy.

#### Delete

The owner (**Delete** in each `/characters` row or on Character details, confirmed) and admins (**Delete** in each `/manage/characters` row — desktop table and mobile card — or on `/manage/characters/[id]`) can hard-delete a Character (`characterRepository.deleteGuarded`, one transaction):

- **Refused** (`CHARACTER_HAS_OPEN_SIGNUPS`, 409) while any non-withdrawn signup (PENDING / SELECTED / NOT_SELECTED — the last can still step in via Replace) on a Run that is not `COMPLETED` / `CANCELLED` references it. Withdraw those signups first, or deactivate instead.
- **Cascades** lockouts, availability blocks, weekly unavailability and WCL performance rows.
- **Keeps history**: signups of finished Runs, historical Booster Access requests and the default-Character pointer keep their rows with the Character reference set to null.
- **Platform Owner protection:** an ADMIN cannot delete the Platform Owner's Characters (`OWNER_ROLE_PROTECTED`); the Owner can.
- Audited as `CHARACTER_DELETED` (owner) / `ADMIN_CHARACTER_DELETED` (with `targetCharacterId`).
- A later Battle.net import of the same character imports it as a fresh Character; manual Characters that still exist are linked instead (auto-link on connect / "Link existing").

Deactivation remains the reversible option.

#### Booster role

The Booster role is a **User** capability (`User.isBooster`, not scoped by raid difficulty), never stored on a Character. `/characters` shows the account's Boosting Roles once above the table (not per Character); Character detail has a compact **Booster signups** note explaining that the account's Booster role covers every difficulty. Neither shows difficulty chips.

When the account is not a Booster, the pages show the **Apply via Discord** CTA; ADMIN grants the role — see [Boosting Roles](#boosting-roles).

A newly created or imported character is **not** booster-eligible merely because it exists or is linked to Battle.net; it is eligible once its owner holds the Booster role (and the other signup rules pass).

#### Characters: Lockouts

Stored `CharacterRaidLockout` rows are read-only here. Operators cannot fabricate lockouts.
Current lockout targets are **all** catalog raids with `currentForLockouts` (Venomous + Tidebound/Tide). Presentation is per-raid with correct boss totals — Tidebound shows as **Tide** and never inherits Venomous's 8-boss denominator. Compact Character list progress is multi-raid (`formatCompactMultiRaidLockoutProgress`), never a merged 9/9.

#### Blizzard authority vs BoostingHub ownership

Two distinct Blizzard reads exist, and only one proves account ownership:

| Read | Used by | Proves ownership? |
| --- | --- | --- |
| Public Character Profile (`profile/wow/character/...`, client-credentials) | Add Character lookup, best-effort enrichment | No — only that the character exists |
| Account Profile (`profile/user/wow`, user OAuth) | Battle.net import/link | Yes |

For every Character, regardless of which path created or touched it: **Blizzard is authoritative for Class and equipped Item Level**. The owner never enters either value. Item level is `null` ("Unknown") when Blizzard has not supplied one — never a manual fallback, never `0`. Specialization is always BoostingHub-owned; Blizzard's active specialization is only a prefill suggestion.

Add Character (Raider.IO profile link → Blizzard lookup → owner picks specialization) does not require a Battle.net connection and does not mark the Character as Blizzard-linked (`blizzardCharacterId` stays unset) — a public lookup is not proof of ownership. If the owner later connects and imports the real Battle.net account, a matching Character is offered as `link` rather than duplicated.

Refresh pulls the latest `equipped_item_level` and may apply a safe rename. A refresh that reads a valid profile but gets no item level back retains the character's last known value rather than clearing it or failing the whole refresh. `lastSyncedAt` is set when a profile sync succeeds. Realm transfer is not applied automatically. Refresh works for every active Character when Blizzard API credentials are configured: linked Characters sync VERIFIED, manual or unconnected ones PUBLIC (see Sync modes).

Full connect/import/link/security policy: [Battle.net integration](#battlenet-integration).

#### Characters: MVCS

- Model: `Character` + `CharacterPlayableSpec` plus `WowClass` / `WowRegion` / `CharacterRole` (`MELEE_DPS` / `RANGED_DPS` for new writes; `DPS` legacy-readable); Blizzard fields on the same row
- View: `/characters`, `/characters/[characterId]`, add/edit dialog, lifecycle buttons, Battle.net panels, Refresh
- Controller: `characterController`, `character.actions.ts`, `blizzard.actions.ts`
- Service: `characterService` (ownership, identity, spec/role, lifecycle), `characterBlizzardImportService` (public lookup, Battle.net import/link), `characterBlizzardSyncService` (refresh, refresh-all, lockout sync)
- Repository: `characterRepository`

#### Characters: Security

- Current user is session-derived
- Ownership is enforced in the service
- Duplicate identity is enforced in the service and the unique constraint
- Class/spec/role rules are enforced in the service
- Class and item level can never be client-supplied: `createCharacterSchema` / `updateCharacterSchema` have no such fields, and the server re-resolves both from Blizzard before persisting
- Clients cannot forge booster eligibility or lockouts through these actions
- Battle.net OAuth tokens are never persisted; see [Battle.net integration](#battlenet-integration)

#### Characters: Deferred

- Automatic realm-transfer handling (Refresh refuses identity changes today; see [Battle.net integration](#battlenet-integration))
- Boss-level lockout rows / signup eligibility redesign (current-raid lockouts sync and stay informational)
- Automatic withdrawal of future signups on deactivate
- Admin global character editing

### Lockout boss-dot semantics

Authoritative mapping for the Characters (and shared `LockoutProgress`) boss-dot UI.
Presentation only — does not change Blizzard sync or lockout derivation.

#### Source of truth

| Field | Meaning |
| --- | --- |
| `CharacterRaidLockout` row for this Character × Raid × Difficulty × regional reset | Difficulty is **verified** |
| No row for that difficulty / raid this reset | **Unknown** — never invent `0/N` kills |
| `killedBossIds` + catalog `RaidBoss` (`sortOrder`) | Which bosses are killed |
| `isComplete` | Difficulty is a **full save** (character locked out of that difficulty) |

#### Dot visual state

One dot = one catalog `RaidBoss` in `sortOrder`. Dot size/spacing is constant; only color changes.

| Visual | Condition | Tooltip state |
| --- | --- | --- |
| **Gray** | Boss not killed, **or** difficulty/raid unverified (Unknown) | `Available` when verified empty; `Unknown` when unverified |
| **Green** | Boss killed and `isComplete === false` | `Saved` |
| **Red** | Boss killed and `isComplete === true` | `Saved` |

Blizzard’s group role model is irrelevant here. Raid Hub’s colors are a visual reference only; BoostingHub does **not** copy Raid Hub’s product meaning.

#### Tooltip

Every focusable/hoverable dot:

1. Boss name (catalog)
2. Difficulty label (`Normal` / `Heroic` / `Mythic`)
3. Exact state (`Available` / `Saved` / `Unknown`)

#### Unknown in the list view

Do **not** print the word “Unknown” in the normal Characters lockout subrow.
Unverified raids/difficulties still render catalog-shaped gray dots; `Unknown` appears only in the tooltip.

### Battle.net integration

#### Battle.net: Purpose

Optionally connect a BoostingHub account to Battle.net so the owner can import or link World of Warcraft characters and refresh item level from Blizzard profile data. After a successful Blizzard profile refresh, BoostingHub may raise stored equipped item level from Raider.IO when that source reports a higher value (soft-fail; never blocks refresh).

Discord remains login. Battle.net is a secondary game-account connection, not a second identity provider for the app session.

#### Discord vs Battle.net

| Concern | Discord | Battle.net |
| --- | --- | --- |
| App login / session | Yes (Better Auth) | No |
| Account role / status | Yes | No |
| Regional WoW account link | No | Yes (`userId` + `EU` \| `US`) |
| Owned-character enumeration | No | Yes (`GET /profile/user/wow`) |
| BoosterAccess | Unrelated | Unrelated |

A user may connect EU, US, both, or neither — connecting an *account* is optional. Add Character itself requires `BLIZZARD_*` to be configured (there is no manual data-entry fallback), but not a Battle.net *connection*: it uses Blizzard's public Character Profile (client-credentials, no user OAuth) to resolve Class and Item Level, which proves the character exists but not that this BoostingHub account owns it. Only the authenticated Battle.net import below establishes ownership.

#### Regional connection

`BattleNetConnection` is unique on `(userId, region)`.

Why regional: Blizzard OAuth and profile namespaces are region-scoped. One BattleTag can cover both regions as separate connections; disconnecting EU must not remove the US link.

The connection stores Battle.net account id, optional BattleTag, granted scope, `connectedAt`, and `lastSuccessfulSyncAt`. It does **not** store OAuth tokens.

#### Ephemeral user OAuth token policy

User authorization-code tokens are exchanged in the callback stack frame, used to:

1. Read Battle.net user info
2. Enumerate owned characters for that region

Then they are dropped. They are never written to `BattleNetConnection`, `BattleNetImportSession`, cookies, or activity payloads.

Character profile status and summary after connect use **client-credentials** tokens (app-level, cached in memory only). That avoids persisting user refresh tokens while still allowing Refresh on linked characters.

#### Import session

After a successful OAuth callback, BoostingHub creates a `BattleNetImportSession`:

- Owned-character snapshot as JSON (ids, names, realms, class, level)
- ~15 minute TTL
- No OAuth tokens
- Client may only select characters present in that snapshot

Why a session: the owned list must be authoritative for import/link so the UI cannot invent Blizzard character ids. When it expires, the user reconnects to refresh the list.

#### Owned character enumeration

During the user OAuth callback only:

```text
GET /profile/user/wow  (regional host + profile namespace)
```

That response is the source of owned candidates for the import session. Later Refresh does not re-enumerate the account; it loads one linked character profile via client credentials.

##### Account profile denied (HTTP 403)

Blizzard can deny `/profile/user/wow` for an individual account even after the authorization code, token exchange and userinfo all succeeded. The client maps exactly that case (HTTP 403 in the `account-profile` context) to `BATTLENET_ACCOUNT_PROFILE_FORBIDDEN`; every other 401/403 — including an `account-profile` 401 — stays `BATTLENET_AUTH_FAILED`. The callback redirects to `/characters?battlenet=error&code=BATTLENET_ACCOUNT_PROFILE_FORBIDDEN`, which explains that sign-in worked but Blizzard did not allow access to the character list.

- Nothing is persisted: no `BattleNetConnection`, no import session (both are written only after the account profile succeeded). The user OAuth token stays ephemeral as always.
- No automatic retry — a repeated denial is not treated as a transient outage. We do not know Blizzard's reason for an individual account.
- Manual Character management keeps working; manual Characters refresh through the public Character Profile APIs (client credentials), which never produce this code. `classifySyncError` therefore does not map it.

#### Scoped Blizzard identity

A linked Character stores:

- `blizzardCharacterId`
- `blizzardRealmId`
- `region` (already on the Character)

Scoped uniqueness is `(region, blizzardRealmId, blizzardCharacterId)`. Multiple unlinked (NULL) Characters remain allowed.

Why not a single global GUID alone: Blizzard character id is realm-scoped in practice and can change meaning across transfers. Region + realm id + character id is the stable link BoostingHub enforces.

#### Import and link flows

Entry: `/characters` when Blizzard env vars are configured.

1. Owner chooses region and starts connect → `GET /api/integrations/battlenet/connect?region=EU|US`
2. Battle.net OAuth completes → `GET /api/integrations/battlenet/callback`
3. Connection upserted; import session opened; existing manual Characters that match the account exactly are **auto-linked** (see below); redirect back to `/characters` with session id and linked count
4. Service resolves each owned row to a candidate status:
   - `import` — create a new Character
   - `link` — attach Blizzard ids to an existing same-owner name/realm/region/class match
   - `already_linked` — already on this account
   - `conflict` — owned by another account, class mismatch, or already linked elsewhere

**Auto-link on connect:** every owned candidate classified `link` (same owner, name, realm, region and class, level ≥ 90, not linked elsewhere) is linked right after the callback through the same `applySelections` path, keeping the Character's own specialization. Ownership is proven by the OAuth account profile; nothing is imported and other users' Characters are never touched. Best-effort per Character — a failure never fails the connection and the row stays available in the import dialog. Once linked, the Character syncs (item level, raid lockouts) like any imported one. Owners whose manual Characters predate their connection simply reconnect once.

Import creates the Character with Blizzard ids. Link only stamps Blizzard identity (and may update item level when the profile is available). Mixed import/link selections submit in one server action; the service resolves classification server-side from the import session.

Character selection happens in a **modal** on `/characters`. The page itself only shows compact regional Battle.net connection cards (**Refresh all**, plus Connect / Reconnect / Import / Disconnect). Import opens the dialog when a live import session exists for that region; otherwise Import starts OAuth reconnect to refresh ownership.

The import modal supports presentation-only **Item Level** sorting (header toggle: descending first, then ascending). Unknown item levels sort last in both directions.

**Refresh all** refreshes every one of the current user's **active** characters in that region — linked ones VERIFIED through the connection, manual / unconnected ones from the public API (no Battle.net connection needed; with one, exact-match links run first) — with bounded concurrency (~4), per-character cooldown skips, and partial-success semantics. It updates item level / safe rename / lastSyncedAt and, when current-raid encounters map successfully, verified current-reset `CharacterRaidLockout` rows. Aggregate messaging distinguishes profiles refreshed, lockouts verified, and lockouts unavailable. It never updates specialization, primaryRole, or BoosterAccess.

Missing or stale (wrong `resetIdentifier` / non-current raid) CharacterRaidLockout rows display as **Unknown** on `/characters` (not "Clear"). A difficulty mode present with zero current-reset kills displays as **0/N**. A tracked difficulty absent from the Blizzard response displays as **?** (unknown), never invented 0/N.

Disconnect clears the regional connection and import sessions. It does **not** delete Characters, signups, lockouts, or history.

#### Specialization and item level

Specialization from Blizzard is an **import-time prefill**. The import modal always lets the owner choose (or confirm) a specialization from the BoostingHub class/spec catalog before Continue. After create/link, specialization and `primaryRole` stay BoostingHub-owned. Refresh does not rewrite specialization.

Battle.net import/link requires character **level ≥ 90** (`MIN_IMPORT_CHARACTER_LEVEL`). Lower-level owned characters remain visible in the import modal as `level_too_low` / “Requires level 90”, but are not selectable. This minimum is specific to Battle.net import/link; the public-lookup Add Character flow does not gate on level.

Class and item level are Blizzard-authoritative everywhere a Character is created or linked, for both flows — the client cannot submit either value; the server always re-resolves them from Blizzard. Item level uses `equipped_item_level` when the public profile returns one. When it does not, item level is stored as `null` ("Unknown") rather than a manual entry or a `0` sentinel, and this alone never blocks import, link, or Add Character. Refresh updates **item level** when Blizzard supplies one (and may apply a safe rename — see below); when a refresh's profile read succeeds but omits item level, the character's last known item level is retained rather than cleared, and name/lockout sync still proceed. After that Blizzard apply, Refresh may **raise** item level from Raider.IO `gear.item_level_equipped` when the public profile returns a finite value strictly greater than the Blizzard equipped item level just applied (or when Blizzard omitted item level). Raider.IO failures, 404s, or lower values leave the Blizzard-applied value unchanged. **Item level never decreases on refresh:** if the newly observed equipped value (Blizzard and/or Raider.IO) is lower than the value already stored — e.g. weapons temporarily unequipped — the previous peak is kept. It does not auto-change class, realm, or specialization.

#### Privacy / profile unavailable

Some characters appear in the account list but have private or invalid public profiles.

The owned-character candidate list on `/characters` is DB-only (import-session snapshot + local match status). Live public-profile enrichment runs only at import, link, or refresh — never while rendering the page — so a large account cannot stall the app shell.

Import/link still proceeds with best-effort enrichment. Missing profile data means default/null suggestions rather than blocking the owned list. Refresh fails with a clear domain error only when the profile itself cannot be read (not found, unavailable, rate-limited); a valid profile that simply omits equipped item level does not fail the refresh, and never becomes a 0 sentinel.

##### Blizzard profile unavailable (status/profile 404)

Real case: a Battle.net-imported character whose **status** and **profile summary** endpoints return 404 while the **raid encounters** endpoint for the same realm/name path answers 200.

- The status + profile summary are the authoritative identity check (Blizzard character id, realm id, class, name). A 404 on either — like `is_valid: false` — is classified as `BLIZZARD_PROFILE_UNAVAILABLE` (not "deleted", not a successful zero-data sync).
- **No raid fallback:** encounters are never requested or persisted when the profile could not be verified. Realm/name paths are not a stable identity (rename, realm transfer, deletion and profile propagation lag all look the same), so raid data is never attached to an unverified identity.
- **Nothing is written:** item level, name, lockouts and `lastSyncedAt` stay exactly as they were. A previously synced character keeps its last known good data; a never-synced one stays unknown (null), never 0.
- **Retry:** `lastSyncedAt` only advances on a verified sync, so the scheduler keeps the character a candidate on its normal cadence; manual Refresh can retry after the 60-second cooldown (which starts at every attempt, failed ones included). One 404 never creates a permanent failure state.
- **Diagnostics:** the attempt is recorded on the Character (`lastSyncErrorCode = PROFILE_UNAVAILABLE`, see [Sync telemetry](#sync-telemetry)) and logged as one safe structured line without any character identity. The scheduled job reports `profileUnavailable=` as a subset of `failed`.
- **UI:** manual Refresh shows "Blizzard profile unavailable. … Log into the character once, log out, then refresh again later." The Characters list and details derive the state from existing data (no sync-status column): a linked character never synced ~30 minutes after it was created shows **Blizzard profile unavailable** with that hint; a previously synced character whose last successful sync is older than the stale window + 30 minutes keeps showing its last known data plus **Blizzard sync failing**.
- Other failures keep their owner-facing semantics: 429 → `BATTLENET_RATE_LIMITED`; 401/403, 5xx, timeouts, malformed JSON → `BLIZZARD_SYNC_FAILED` (the original code is kept as the error's `cause` so telemetry can still classify it).

#### Sync telemetry

Every real Blizzard sync attempt of a linked Character — scheduled sync, owner Refresh, owner regional Refresh All, and the admin Sync now / Force refresh / Force refresh all in [`/manage/characters`](#character-operations) — goes through **one** entry point, `syncLinkedCharacterProfile` (`character-blizzard-sync.service.ts`). The lower-level profile refresh is module-private, so no path can skip it.

Persisted on `Character` (no sync-history table):

| Field | Meaning |
| --- | --- |
| `lastSyncedAt` | Last **successful** sync (unchanged semantics; scheduler freshness uses only this) |
| `lastSyncAttemptAt` | Start of the latest real attempt, successful or not |
| `lastSyncErrorAt` | Latest failed attempt; cleared on success |
| `lastSyncErrorCode` | Safe category of that failure; cleared on success |
| `syncFailureCount` | Consecutive failures; reset to 0 on success |

- **Attempt:** `lastSyncAttemptAt = now`. Nothing else changes; `Character.updatedAt` ("Updated") is preserved because bookkeeping is not a Character data change.
- **Success:** `applyBlizzardSync` writes the profile, `lastSyncedAt` and the cleared failure fields in **one** statement.
- **Failure:** `lastSyncErrorAt = now`, `lastSyncErrorCode = category`, `syncFailureCount + 1`. Name, item level, `lastSyncedAt` and lockouts keep their last known good values. A failing telemetry write is logged and never replaces the real outcome.
- A verified Battle.net import/link enrichment also sets `lastSyncAttemptAt` (it is a real Blizzard round-trip). Eligibility failures (retired) are not attempts and are never recorded.

**Safe categories** (`classifySyncError`, `src/lib/blizzard/sync-error.ts` — the only mapping): `PROFILE_UNAVAILABLE` (404 / `is_valid=false`), `IDENTITY_CONFLICT` (class, Blizzard id or realm/transfer mismatch), `NAME_CONFLICT` (rename collision or unstorable name), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (5xx, network, timeout, invalid JSON), `AUTH_OR_CONFIG` (app credentials rejected or Battle.net not configured), `INTERNAL` (anything else). Only the code is stored — never messages, URLs, payloads or tokens (a CHECK constraint limits the column to these values).

**Logging:** each failed attempt writes one JSON line — `{"event":"character_sync_failed"|"character_sync_rate_limited","errorCategory","trigger","region","rateLimited","retryable"}`. It never contains character/owner ids or names, Discord identity, emails, messages, upstream data or credentials; per-Character diagnosis comes from the persisted telemetry.

**Sync modes.** Every active Character is synced — Blizzard is always read by realm + name with the client-credentials token:

- **VERIFIED** (`LINKED`: Blizzard ids + the owner's regional connection, ownership proven at import/link): stored ids are checked and the connection's `lastSuccessfulSyncAt` is marked.
- **PUBLIC** (`NOT_LINKED` manual Characters, or `NO_CONNECTION`): public profile data only — item level and raid lockouts. The class must match; stored ids (if any) are still checked; Blizzard ids are **never stamped** by a public sync, so the real owner can still import/link it later (the auto-link on connect then upgrades it to VERIFIED). Shown as **Public API** on `/manage/characters`.

Manual Refresh, owner Refresh all (all active Characters of the region, connected or not), admin Sync now / Force refresh / Force refresh all and the scheduler all use the same eligibility: active = eligible; only retirement blocks a sync.

**Health** (`src/lib/blizzard/sync-health.ts`, pure): linkage (`LINKED` / `NOT_LINKED` / `NO_CONNECTION`) is separate from health, which exists for every active Character with precedence `ERROR` (a failure newer than the last success) > `NEVER_SYNCED` > `STALE` (last success older than `BLIZZARD_SYNC_STALE_MINUTES` + 30 min grace) > `HEALTHY`. Retirement is reported separately. The owner-facing Characters page state uses the same stale primitive.

**Per-Character lock:** each attempt holds a non-blocking PostgreSQL advisory lock `(837463, hashtext(characterId))` (`src/lib/character-sync-lock.ts`) on one dedicated lock session per process (outside the 5-connection pool). A Character already being synced anywhere — web process or scheduled job — is refused (`CHARACTER_SYNC_IN_PROGRESS`, 409) by manual Refresh and skipped by Refresh All and the scheduler, without an attempt. The scheduler's whole-job lock `(837462, 1)` is unchanged.

#### Rename and realm transfer

On Refresh:

- **Rename (same realm identity):** allowed when the new name does not collide with another of the owner's Characters on that realm/region. `normalizedName` stays in lockstep.
- **Realm transfer:** if Blizzard returns a different `blizzardRealmId` (or character id), Refresh refuses. Automatic transfer handling is not supported; operators resolve identity manually.

Class mismatch against the stored Character is also refused so eligibility history stays coherent.

#### BoosterAccess independence

Linking or importing a character does not create, approve, or revoke `BoosterAccess` or any Boosting Role. Booster eligibility remains an explicit BoostingHub account-level capability (`User.isBooster`). Matching Characters reuse existing approvals. See [Boosting Roles](#boosting-roles).

#### Lockout derivation (Character Raid Encounters)

Blizzard does **not** expose a direct SavedInstances-style lockout endpoint. BoostingHub derives **current-reset raid boss kill progress** from:

`GET /profile/wow/character/{realmSlug}/{characterName}/encounters/raids`

using the regional `profile-{region}` namespace and server-side client-credentials auth.

##### Current vs historical raid references

`src/lib/wow-raid-catalog.ts` holds stable BoostingHub raid UUIDs that must not be overwritten when seasons change:

| Raid | Role | Journal instance id |
| --- | --- | --- |
| Manaforge Omega | Historical (existing Runs keep this id) | `1302` |
| The Venomous Abyss | **Current** lockout target (`currentForLockouts: true`) | `1320` |

Several raids may carry the flag at once (one per current content); `src/lib/wow-raid-catalog.ts` and the Raid Catalog's *Lockout tracking* decide, and the table above is only an example.

Besides the count (`bossesDefeated`), each verified row stores **which** catalog bosses were killed this reset (`CharacterRaidLockout.killedBossIds`, JSON array of catalog boss ids). The lockout lines on the Roster builder, the Signups list and the signup dialog show them on hover (✓ killed · ✗ open, catalog order). Rows synced before this existed show "boss details after the next character sync".

Lockout refresh uses the explicit `currentForLockouts` flag — not array order, newest DB row, or boss count (both raids have 8 bosses). Matching prefers Blizzard journal instance + encounter ids; localized names (e.g. de_DE “Der Giftige Abgrund”) are presentation only. Tidebound Grotto (single-boss lair, instance `1317`) is not merged into Venomous Abyss lockouts.

Whether a raid may be planned for new Runs is `availableForRuns` (see Historical raid availability). Historical Manaforge Runs are never rewritten to Venomous.

##### Semantics

- For each **verified** difficulty (`NORMAL` / `HEROIC` / `MYTHIC`): killed this reset iff `last_kill_timestamp` is in `[resetStart, resetEnd)`.
- Do **not** treat historical `completed_count > 0` alone as current lockout.
- Regional weekly reset windows (`src/lib/wow-weekly-reset.ts`): EU Wednesday 04:00 UTC; US Tuesday 15:00 UTC. Identifiers use `resetIdentifierFor(resetStart)`. Signup/Roster target the same helper via `lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt)` — never `resetIdentifierFor(run.scheduledStartAt)` alone.
- Difficulties map centrally in `src/lib/blizzard/raid-difficulty.ts` (LFR / Story ignored).

##### Clear vs Unknown (per difficulty)

| Situation | Display |
| --- | --- |
| Current raid found + difficulty mode present + zero current-reset kills | **0/N** (verified clear for that difficulty) |
| Current raid found + difficulty mode absent | **?** for that difficulty (not 0/N) |
| API failure, missing current raid mapping, no supported modes | **Unknown** overall — never invent Clear |
| Persisted row with wrong `resetIdentifier` or non-current raid | Ignored for current display |

Profile success and lockout verification are independent: itemLevel may update while lockouts stay unverified. Encounters data may lag until Blizzard publishes (often after logout). `CharacterRaidLockout.updatedAt` is last successful lockout verification time.

##### Mythic limitation

Mythic progress is boss-kill progress in the current reset only. This API does **not** expose Mythic saved-instance IDs or lock-extension state.

##### Persistence and refresh

Verified difficulty aggregates upsert into existing `CharacterRaidLockout`. Missing modes for the current raid+reset are deleted so they remain Unknown. Same-reset rows for non-current catalog raids are cleared on successful sync. No parallel BlizzardLockout domain.

Signup / roster lockout display uses the Character region's regional reset containing the Run schedule. Verified `0/N` is Unsaved (distinct from Unknown). Lockouts remain informational — never a hard signup/roster blocker. No Warcraft Logs, Raider.IO, or addon required.

#### Battle.net: Security

- Connect and callback require an authenticated BoostingHub session
- OAuth `state` nonce is bound to an HttpOnly cookie that also carries `userId`, `region`, and expiry; callback rejects mismatches and clears the cookie
- User OAuth tokens never leave the callback/service stack as persisted data
- Import/link selections must match the live import session snapshot
- Character ownership is enforced in services for link and refresh
- Tokens and secrets are not returned to the client or activity feed
- Refresh is rate-limited: 60s cooldown per character, measured from the latest attempt (failed attempts included)

#### MVCS map

| Layer | Location |
| --- | --- |
| Model | `BattleNetConnection`, `BattleNetImportSession`, Character Blizzard fields |
| View | `/characters` Battle.net connection cards + import modal, character detail Refresh |
| Controller | `src/app/api/integrations/battlenet/connect/route.ts`, `callback/route.ts`, `blizzard.actions.ts`, `app.controller` character page panel |
| Service | `battleNetService`, `characterBlizzardImportService` (public lookup, import/link), `characterBlizzardSyncService` (refresh, refresh-all, lockout sync) |
| Integration | `src/integrations/blizzard/blizzard-api-client.ts` (external HTTP boundary) |
| Lib | `src/lib/blizzard/*`, `src/lib/wow-weekly-reset.ts`, `src/lib/lockout-display.ts`, `src/lib/wow-raid-catalog.ts` |
| Repository | `battleNetConnectionRepository`, `battleNetImportSessionRepository`, `characterRepository`, `lockoutRepository` Blizzard helpers |
| Validators | `src/validators/blizzard.ts` |

Views do not call Blizzard or Prisma. Controllers authenticate, validate, and delegate.

#### Battle.net: Deferred

- Automatic realm-transfer handling
- Boss-level persisted lockout rows / signup eligibility redesign
- Persisted user OAuth tokens or long-lived user refresh (intentionally rejected)
- Using Battle.net as app login
- Admin tools to reassign Blizzard identity across accounts
- Live Blizzard raid catalog ingestion (reference catalog + DB persist remain operator-owned)

Routes are in [API.md](API.md#battlenet-integration-routes), configuration in [OPERATIONS.md](OPERATIONS.md#configuration-and-environment-variables).

### Scheduled character sync

#### Sync: Purpose

Blizzard profile data and current-raid lockouts on an already-linked Character drift out of date between manual refreshes. This feature adds an automatic background refresh for every stale, active Character — linked ones VERIFIED through the owner's connection, manual ones PUBLIC by realm + name (see [Battle.net integration](#battlenet-integration)) — without the app owning a recurring timer.

It reuses the exact same lower-level refresh logic as manual "Refresh" / "Refresh All" (`character-blizzard-sync.service.ts`): profile fetch/validate/apply, optional Raider.IO equipped-ilvl raise when higher than Blizzard, monotonic item-level (never decreases below the stored peak), current-raid lockout sync, identity/realm-transfer safety checks, and the "missing item level never clears the existing one" guarantee. This feature only adds the *orchestration* around calling that logic for many Characters, globally, on a schedule it does not itself keep.

#### One-shot architecture — no internal timer

**The app never owns the external scheduler cadence.** There is no `setInterval`, no recursive `setTimeout`, no `while (true)` loop, and no cron library daemon anywhere in this feature. Instead:

```text
External scheduler (systemd timer in production)
  → npm run sync:characters   (one process invocation)
    → scheduledCharacterSyncService.runOnce()   (one sync cycle)
    → process exits
```

One invocation performs exactly one cycle, then the process exits with a status code. Scheduling the next tick is entirely an infrastructure concern, external to this codebase.

This is a deliberate difference from the Discord bot (`src/discord-bot/`), which *is* a long-lived process — the scheduled sync script is not, and must not be run from inside the bot process or a Next.js API route with its own timer.

#### Scheduler cadence vs stale threshold

These are **separate** concepts:

| Concept | Recommended value | Who owns it |
| --- | --- | --- |
| External scheduler tick | ~every **15 minutes** | Infrastructure (systemd timer in production) |
| Character stale threshold | **120 minutes** (2 hours) | Application (`BLIZZARD_SYNC_STALE_MINUTES`) |

Why both:

- The scheduler runs often enough that a failed or rate-limited Character can retry on the next tick without waiting another two hours.
- The stale filter skips Characters that were successfully synced within the last two hours, so most 15-minute ticks find **zero** candidates and make **no** Blizzard requests.
- Successful Characters therefore synchronize about every two hours under normal conditions.

Example timeline:

```text
12:00  Character successfully synced
12:15  scheduler runs → Character fresh → skipped (no Blizzard call)
12:30  …skipped…
…
14:00  Character is stale → sync candidate → Blizzard refresh
14:00  (if that refresh fails) Character remains stale
14:15  scheduler runs → still stale → eligible again
```

Do **not** configure the external scheduler to run only once every two hours — that would delay retries after transient Blizzard failures.

#### Stale threshold

```ts
const DEFAULT_STALE_MINUTES = 120; // BLIZZARD_SYNC_STALE_MINUTES
```

Configurable via `BLIZZARD_SYNC_STALE_MINUTES` (see `.env.example`):

- Unset → defaults to **120 minutes** (2 hours).
- Set to a positive integer → used as-is (e.g. `15`, `30`, `120`).
- Set to anything else (zero, negative, fractional, non-numeric) → the job fails loudly (`resolveScheduledSyncStaleMs()` throws) rather than silently falling back or permitting a 0-minute busy-loop threshold. A misconfigured production value should be visible, not quietly hammer Blizzard every cycle.

Production recommendation:

```env
BLIZZARD_SYNC_STALE_MINUTES=120
```

A Character with `lastSyncedAt === null` is always stale and eligible.

##### Boundary comparison

Eligibility uses a strict `<` against `staleBefore = now - threshold`:

- `lastSyncedAt < staleBefore` → stale (candidate)
- `lastSyncedAt === staleBefore` → fresh (skipped)
- `lastSyncedAt > staleBefore` → fresh (skipped)

So at an exact two-hour boundary the Character is treated as still fresh.

#### Candidate selection

A Character is a sync candidate only if **all** of:

- `isActive === true`
- it is stale per the threshold above

Linkage only decides the sync mode: a Character with Blizzard ids and an owner connection for its region syncs VERIFIED, every other active Character syncs PUBLIC.

`characterRepository.listScheduledSyncCandidates({ staleBefore })` implements this as two bounded queries, regardless of how many Characters or Users exist:

1. One `Character` scan filtered to `isActive`, with the owning `User` eager-loaded (`.include("user")`) for attribution. Staleness itself is filtered in-process, because the ORM's public field-proxy API has no OR combinator to express "`lastSyncedAt` is null or older than X" as one predicate.
2. One batched `BattleNetConnection` lookup (`.where((c) => c.userId.in([...]))`) across the distinct owner ids from step 1, joined in-memory by `${userId}:${region}`.

This is never a User → Character → connection N+1 scan.

#### Global concurrency

At most **4** Character refreshes run at once, globally — not 4 per User, per region, or per connection. Enforced by the shared `mapWithConcurrency` helper (`src/lib/concurrency.ts`), the same round-robin worker pool manual "Refresh All" uses (`REFRESH_ALL_CONCURRENCY`). If 30 Characters across many Users/regions are eligible, still only 4 are ever in flight.

#### Overlap protection

If the external scheduler starts a new cycle while a prior one is still running (e.g. a slow cycle overruns the ~15-minute tick), the second invocation must not perform another full sync.

Implemented with a PostgreSQL **session-level advisory lock** (`scheduledJobLockRepository`, `src/repositories/scheduled-job-lock.repository.ts`) using `pg_try_advisory_lock` / `pg_advisory_unlock` on a stable, documented key pair: `(837462, 1)`. Session-level locks are bound to the physical backend connection, not to a query — so the repository acquires a dedicated client from the shared `pgPool`, holds that *same* client for the full job, and releases the lock on that same client before returning it to the pool. It never acquires through one pooled query and assumes another connection owns the lock.

If the lock cannot be acquired, `runOnce()` returns `{ status: "SKIPPED_ALREADY_RUNNING" }` immediately — no Blizzard calls, no candidate loading, no mutations — and the script exits `0`. An expected overlap is not a process failure.

#### Data ownership

Scheduled sync **may** update, per successfully-refreshed Character:

- `Character.name`, `normalizedName`
- `Character.itemLevel` (only when Blizzard supplies one — see below)
- `Character.lastSyncedAt`
- the sync telemetry fields (`lastSyncAttemptAt`, `lastSyncErrorAt`, `lastSyncErrorCode`, `syncFailureCount`) — for every attempt, successful or failed
- current-raid `CharacterRaidLockout` rows
- `BattleNetConnection.lastSuccessfulSyncAt` (grouped — see below)

Scheduled sync **never** updates `Character.specialization` or `Character.primaryRole` — those are Character metadata a Blizzard sync must not overwrite (only the User editing the Character changes them). Item level may still be raised from Raider.IO after the Blizzard apply when that source reports a higher equipped value (same soft enrichment as manual Refresh). It also never calls `applyBlizzardLink()` (the initial-link path); it only ever calls `applyBlizzardSync()`, same as manual refresh — a PUBLIC sync never stamps Blizzard ids.

It also never changes Weekly Availability, Boosting Roles, historical Booster Access requests, signup/roster/run commitments, or attendance data.

##### Partial failure policy

One broken Character (profile unavailable, character deleted server-side, identity/class mismatch, realm transfer, transient Blizzard error) does not fail the job. It is counted in `failed` (a Blizzard status/profile 404 additionally in `profileUnavailable` — see [Battle.net integration](#battlenet-integration)) and the cycle continues with the remaining candidates. On any such failure, the Character's existing `itemLevel` and lockout rows are left untouched — never cleared to `0`/`null`/empty. A failed Character remains stale and is eligible again on the next external scheduler tick.

##### Lockout sync failure

If the profile refresh succeeds but the lockout-encounters call fails or is unusable, the profile fields (`name`, `itemLevel`, `lastSyncedAt`) still update and the *prior* lockout rows are preserved untouched — the Character is counted in `lockoutsUnavailable`, not `failed`.

##### Rate limiting

If Blizzard returns `BATTLENET_RATE_LIMITED` for any candidate, the job stops dispatching *new* refreshes for the remainder of the cycle (already-in-flight requests are left to settle) rather than retrying into the rate limit. Every candidate that hit the limit or was skipped because of it is counted in `rateLimited`, and the cycle still exits cleanly and reports its result — no retry storm, no long in-process sleep (the current Blizzard API client does not expose a trustworthy `Retry-After` contract to sleep against, so the deliberate, documented choice is to stop the cycle conservatively instead).

Because the external scheduler runs again approximately 15 minutes later, still-stale Characters naturally become candidates again without an in-process retry loop.

##### Configuration failure

If Battle.net credentials are globally missing (`BATTLENET_NOT_CONFIGURED`) and there is at least one candidate, the job fails fast — before issuing any Blizzard calls — instead of reporting every candidate as an individual failure. The script exits non-zero with a clear message and never logs the credential values themselves.

##### Connection sync timestamp

Successful refreshes are grouped by `BattleNetConnection`. A connection's `lastSuccessfulSyncAt` is marked **once per cycle** if at least one of its Characters refreshed successfully — never once per Character, and never at all if every Character for that connection failed.

#### Failure backoff (scheduler only)

A stale Character whose automatic sync keeps failing is not retried every tick forever. After candidate selection, `runOnce` drops Characters still inside their backoff window (`src/lib/blizzard/sync-backoff.ts`, `resolveCharacterSyncRetryAt`), measured from `lastSyncAttemptAt` and driven by `syncFailureCount` + `lastSyncErrorCode`:

| Consecutive failures | PROFILE_UNAVAILABLE / IDENTITY_CONFLICT / NAME_CONFLICT | UPSTREAM_UNAVAILABLE / INTERNAL | RATE_LIMITED / AUTH_OR_CONFIG |
| --- | --- | --- | --- |
| 0–2 | none | none | none |
| 3–5 | 1h | 1h | none |
| 6–9 | 6h | 1h (capped) | none |
| 10+ | 24h | 1h (capped) | none |

- Persistent, Character-specific problems (deleted / renamed / transferred Character, identity or name conflict) back off progressively. Transient upstream problems are capped at 1h so one outage never parks a Character for a day. `RATE_LIMITED` stays governed by the whole-run 429 stop, and `AUTH_OR_CONFIG` is a system problem (the job fails fast when Battle.net is not configured).
- The filter runs over the **complete** stale set: the candidate query has no `LIMIT`/ordering/paging, so backed-off rows can never crowd eligible ones out of a window (regression-tested). If a row limit is ever added, backoff must move before it.
- A backed-off Character is **not attempted**: it counts as `skippedBackoff` (neither refreshed nor failed), its telemetry and error stay as they are, and `--dry-run` reports `inBackoff`.
- The backoff is scheduler-only. Owner Refresh / Refresh all and admin Sync now / Force refresh / Force refresh all ignore it (the normal 60s manual cooldown still applies; Force still bypasses it).
- A successful sync resets `syncFailureCount` and `lastSyncErrorCode`, which removes the backoff; normal freshness scheduling resumes. Nothing is deleted, retired, renamed or unlinked.
- `/manage/characters` shows "Auto retry in …" on backed-off rows; the detail page shows the exact automatic retry time (same helper).

#### Relationship to manual refresh

Manual refresh (`characterBlizzardSyncService.refreshCharacter` / `refreshLinkedCharactersForRegion`) keeps its **60-second** `REFRESH_COOLDOWN_MS`, measured from `lastSyncAttemptAt` — the start of the latest attempt, successful or failed — so a failing Character cannot be retried every second. "Refresh All" is still available from the Web UI.

The scheduled job's **120-minute** stale threshold is a completely separate concept from the manual cooldown:

- Background: last sync 45 minutes ago → considered fresh → scheduler skips.
- User presses Refresh → existing manual path may refresh immediately (subject to the ~60-second manual cooldown only).

Do not share configuration between these two paths.

Both paths call the same `syncLinkedCharacterProfile(owner, character, connectionId, options)` entry point, which owns the per-Character lock and the sync telemetry (see [Sync telemetry](#sync-telemetry)). The job never selects candidates by `lastSyncAttemptAt` — freshness stays success-based, so a failing Character remains a candidate every tick. A candidate already being synced elsewhere (per-Character lock held) is skipped without an attempt and counted in `skippedInProgress`. It takes a minimal `CharacterSyncOwner = { id, name }` context rather than a full `AuthenticatedUser`, because the scheduled job has no logged-in User — it builds this context from the Character's real, persisted owner (via the eager-loaded `User` relation), never a fabricated `ADMIN` user or a bypassed ownership check.

#### Activity logging

Routine scheduled sync writes **no** `ActivityEvent` rows — not one per Character, and not one per cycle. `refreshLinkedCharacterProfile` is always called with `writeActivity: false` and `updateConnectionSync: false` from the scheduled job (the connection timestamp is instead marked once per connection by the orchestration service itself, as described above). Operational results go to process/console logging (`console.info`/`console.error`), one summary line per cycle, exactly like the script's own printed summary.

#### Relationship to informational raid saves

Raid lockouts are informational only, never a signup blocker (see [Run signups](#run-signups)). Scheduled sync will make lockout data fresher — e.g. turning `HC 1/8` into `HC 8/8` between manual refreshes — but this can never, by itself, make a Character ineligible for a signup. `CHARACTER_ALREADY_SELECTED_OTHER_RUN` (cross-run Character reservation) is a separate, unrelated, still hard-blocking rule that this feature does not touch.

### Character Operations

Admin-level area (ADMIN and OWNER — `hasAdminAccess`; USER and RAID_LEAD are denied on pages, actions and services) for inspecting every Character centrally and running Blizzard syncs, instead of navigating through individual user profiles. It reuses the sync telemetry, health model and locks from [Sync telemetry](#sync-telemetry); there is no second sync implementation.

#### Operations: List

- **Summary** (active Characters only — retired never count as problems): Total (with retired count), Healthy, Stale, Sync errors, Never synced, Blizzard linked, No connection. Each problem card links to the matching filter. The summary is computed from the same derived rows as the table.
- **Table:** Character (class icon/colour, item level, link to the detail page), Owner (link to `/manage/users/[id]`), Class, Region / Realm, Status (Active / Retired), Last success (relative, exact time on hover), Sync health, Blizzard/API (linkage + readable error category and failure count on errors), Lockouts, Actions.
- **Lockouts:** one line per current raid/content (catalog order, e.g. *The Venomous Abyss*, *Tide*) with `N x/N · HC x/N · M x/N`. A raid without verified current-reset rows shows **Unknown**; an explicit `0/N` is a verified zero. Old resets are never shown.
- **Filters** (URL parameters, combinable): character/realm text, owner (name, Discord username or id), class, region, status (All / Active / Retired), Blizzard (Linked / Not linked / No connection), sync health. A health filter matches active Characters only.
- **Sorting** (stable, ties by name): Character, Owner, Last success (most recent first, never-synced last), Sync health (problems first: Error → Stale → Never synced → Healthy → No connection → Not linked → Retired).
- **Query shape:** one Character query (owner + only current-reset rows of the current raids) plus one Battle.net connection query — independent of the number of Characters. No pagination at the current scale (~90 Characters).

#### Operations: States

| Linkage | Meaning |
| --- | --- |
| Linked | Blizzard ids present and the owner has a Battle.net connection for the Character's region |
| Not linked | No Blizzard ids (manual Character) — synced PUBLIC by realm + name, shown as **Public API** |
| **No connection** | Blizzard ids present but the owner has **no** Battle.net connection for that region — synced PUBLIC instead of VERIFIED, so it is highlighted |

Sync health exists for every active Character: **Error** (the latest failure is newer than the latest success) › **Never synced** › **Stale** (last success older than `BLIZZARD_SYNC_STALE_MINUTES` + 30 min) › **Healthy**. Retired Characters show **Retired**.

Error categories are shown as readable copy only: Profile unavailable, Character identity conflict, Character name conflict, Blizzard rate limited, Blizzard API unavailable, Blizzard authentication/configuration error, Internal sync error. Raw upstream messages are never stored or shown.

#### Detail (`/manage/characters/[id]`)

Read-only operations view: identity (realm, region, class, specialization, role, item level, active/retired), owner, Blizzard linkage and connection (and Blizzard ids), sync telemetry (last attempt, last success, health, last error time, category, consecutive failures), the per-raid × difficulty lockout matrix (verified vs Unknown), current Weekly Availability, and the owner's Boosting Roles (read-only). No Character editing.

#### Operations: Actions

Eligibility for every sync action: the Character is **active** (retired → disabled with the reason; the server refuses with `CHARACTER_SYNC_NOT_ELIGIBLE`). Linked Characters whose **owner** (resolved server-side — never the acting admin) has a Battle.net connection for the region sync VERIFIED; manual / unconnected ones sync PUBLIC from the public Blizzard API (item level + lockouts, badge **Public API**) — see [Battle.net integration](#battlenet-integration).

- **Delete** (list row actions next to Open / Sync now / Force refresh, desktop and mobile, and the detail page) — confirmed hard delete of any Character, with the owner-delete guard (refused while an unfinished Run has a non-withdrawn signup on it). The Platform Owner's Characters are protected from ADMINs: their rows show **Delete protected** instead of a button, and the server still refuses with `OWNER_ROLE_PROTECTED`. See [Delete](#delete).

- **Sync now** — the normal 60-second cooldown (measured from the last attempt) applies.
- **Force refresh** — confirmation required; bypasses only the 60-second cooldown. Identity/class/realm checks, rate-limit handling, telemetry and the per-Character lock stay in force. Still available while the bulk cooldown is active.
- **Force refresh all** — confirmation shows the eligible count (re-resolved server-side when it runs; no client id list). It:
  - runs synchronously with **concurrency 4** and a **~120 s work budget** (unstarted Characters are reported as skipped);
  - stops starting work after the first Blizzard **429** (the rest are skipped as rate limited);
  - skips Characters that are already syncing (per-Character advisory lock) — one failure never aborts the batch;
  - holds the **same whole-job advisory lock as the scheduled sync** (`837462, 1`): while the scheduler (or another bulk run) is running it is refused with "Character synchronization is already in progress.";
  - has a **10-minute global cooldown** that starts when a run is accepted. The durable marker is the latest `ActivityEvent` of type `CHARACTER_BULK_FORCE_REFRESH_STARTED` (checked and written while holding the job lock);
  - returns eligible / attempted / succeeded / failed / skipped with the failed and skipped Characters and their safe reason.

Activity events: `ADMIN_CHARACTER_SYNC`, `ADMIN_CHARACTER_FORCE_REFRESH`, `ADMIN_CHARACTER_DELETED` (actor = admin, `targetCharacterId=`, outcome category), `CHARACTER_BULK_FORCE_REFRESH_STARTED` and `…_COMPLETED` (counts).

If the eligible population ever grows far beyond what fits the budget (Apache `Timeout 300`), move bulk refresh to the existing one-shot systemd job pattern rather than adding a queue.

### Raid Catalog

`/manage/raid-catalog` (legacy `/manage/content` redirects here) — ADMIN / OWNER only.

Raids and their bosses are **imported from the Blizzard Adventure Journal**. Admins no
longer type raid names, boss lists or Blizzard encounter ids. Products (run presets)
stay BoostingHub data and are edited by hand.

#### Data ownership and Blizzard identities

##### Data model

| Table | Field | Owner | How it is set |
| --- | --- | --- | --- |
| `Raid` | `name`, `blizzardInstanceId` | Blizzard | Import and refresh |
| `Raid` | `season`, `sortOrder`, `trackLockouts`, `isActive` (*Available for new Runs*) | BoostingHub | By an Admin |
| `Raid` | `wclZoneId`, `wclRankingEncounterId` | Warcraft Logs | Detected by name (soft fill); *Retry detection* overwrites |
| `RaidBoss` | `name`, `sortOrder`, `blizzardEncounterIds` (JSON array) | Blizzard | Import and refresh |
| `RaidBoss` | `wclEncounterIds` (JSON array) | Warcraft Logs | Detected by name (soft fill) |
| `Product`, `ProductRaidContent` | name, flags, ordered contents, FIXED / VARIABLE boss counts | BoostingHub | By an Admin |
| `RunTemplateRaidContent`, `RunRaidContent` | `raidId`, `plannedBossCount` | BoostingHub | Written by Run Setup / Run flows only |

Boss count is never stored: it is `RaidBoss` rows per raid (`RaidCatalog.bossTotal`).
Boss **order** is display only — planned counts (`plannedBossCount`, product 5/8) are
numbers, not "the first N bosses", and lockouts store boss UUIDs (`killedBossIds`).

##### Blizzard identities (verified live, EU, 2026-10-23)

- **Instance endpoint:** `GET /data/wow/journal-instance/{id}?namespace=static-{region}` returns
  `name`, `category.type`, `expansion`, `modes`, `order_index` and the ordered
  `encounters[] {id, name}` (`blizzardApiClient.getJournalInstance`).
- **Canonical instance identity = journal instance id.** The character encounters response
  (`/profile/wow/character/{realm}/{name}/encounters/raids`) carries, per instance,
  `instance: { key: { href: ".../data/wow/journal-instance/1320?..." }, name, id: 1320 }`
  — it *links to the journal instance*; the ids are the same identity (sample: eredar/zeti:
  1314, 1307, 1308, 1305, 1317, 1320, 1324 — all equal to the journal ids). Production
  lockouts are already derived through `Raid.blizzardInstanceId` = journal id (1320, 1324).
  One field is correct; there is no second id to store.
- **Boss identity = journal encounter id.** Encounters in the profile response link to
  `/data/wow/journal-encounter/{id}` with the same `id` (2888, 2896, …).
  `deriveCurrentResetLockouts` matches `encounter.id` against `RaidBoss.blizzardEncounterIds`.
- **Lockout identity** = character + raid (via instance id) + difficulty + weekly reset
  (`CharacterRaidLockout` unique key); bosses via encounter id → `RaidBoss.id`.
- Category alone does not mean "real raid": the Midnight **world bosses** are journal instance
  1312, `category: RAID`, `modes: [NORMAL]`.

##### Seasons

Blizzard has **no authoritative raid-season membership API**. `mythic-keystone/season` covers
dungeons only. The journal tier "Current Season" (`journal-expansion/505`) lists *every*
Midnight raid — Season 1 and Season 2 plus the world-boss instance — identical to the
"Midnight" tier (516). Seasons are therefore small, version-controlled definitions in
`src/lib/raid-seasons.ts` (key, name, `current`, `journalInstanceIds`). No season CRUD UI.

##### WCL

`warcraft-logs-raid-metadata.service.ts` resolves zone / encounter ids by exact unique
name; it never guesses and soft discovery fills only empty fields. Blizzard and WCL ids
are different id spaces (Kith'ix: WCL `journalID` 3271 vs Blizzard 2896; WCL encounter
3513). Imports keep using soft discovery only, so manual / seeded WCL ids are never
overwritten, and a missing WCL match only shows "Needs mapping".

#### Import / sync behaviour

All writes are keyed by the Blizzard instance id and run in one transaction **after**
every Blizzard request has succeeded: a failed or invalid Blizzard response writes nothing
and the admin sees the reason (not found / not a raid / rate limited / unavailable).

- **Import Raid** — enter a journal instance id → *Fetch* → preview (name, boss count,
  bosses, NEW / ALREADY IMPORTED / UPDATE AVAILABLE) → *Import*. Season and lockout
  tracking default from the season definition containing the id.
- **Import Season** — pick a code season → preview of every raid → *Import*. New raids of
  the current season start with lockout tracking on; for historic seasons it is a choice.
- **Refresh from Blizzard** (raid detail) — preview, then updates only Blizzard-owned
  metadata: raid name, boss names, boss order, encounter ids.

Matching: an existing raid by instance id; otherwise one unlinked raid with the same
(normalized) name is adopted instead of duplicated. Bosses by encounter id; unlinked
bosses by unique name (or one boss ↔ one encounter).

Never written by import / refresh: season, order, lockout tracking and run availability of
existing raids, WCL ids already set, Products, `ProductRaidContent`, `RunTemplateRaidContent`,
`RunRaidContent`, Runs. New raids are not offered for new Runs until an admin enables it.

**Reconciliation.** A raid that is in use (Runs, Run Setups, Products, lockouts) or seeded
keeps its encounter set: Blizzard bosses that are new, or bosses Blizzard stopped
returning, are listed in the preview as *needs reconciliation* and are not added / deleted.
Unused raids follow Blizzard (new bosses added, missing bosses removed).

#### Status per raid

- **Blizzard** — synced (instance linked) or not linked.
- **Bosses** — `N/N mapped` (bosses with a Blizzard encounter id).
- **Lockouts** — ready (tracked + instance + every boss mapped), incomplete, or not tracked.
- **Warcraft Logs** — mapped (zone + every boss) or needs mapping.

Raw ids are shown only in the expanded details.

#### Page sections

`/manage/raid-catalog?tab=raids` (default; missing / unknown values fall back here) shows
the imports and the raid list; `?tab=presets` shows Run Presets (Products). The tab is a
real link, so refresh, back / forward and copied URLs keep it.

The Raids tab is scoped so the working catalog stays short after many seasons:

- **Status** (`?status=`): *Active* (default, not archived), *Archived*, *All*.
- **Season** (`?season=`): *Current season* (default for Active — the `RAID_SEASONS` entry marked
  `current`), one persisted `Raid.season` value, or `all`. Options are the persisted
  seasons, Blizzard seasons newest first (`RAID_SEASONS` order), then other values A–Z.
  No season names are hard-coded in the UI.
- Without a chosen season, Archived and All look across every season, so an archived raid of
  an older season is one click away; an explicit season still narrows them.
- Defaults are left out of the URL; unknown values fall back to Active / Current season.
- The tab count is the number of raids the Raids tab shows; the status control shows
  Active / Archived / All counts inside the chosen season.

**No automatic archive on Import Season.** An import never changes lifecycle or
availability of existing raids. Season membership is the editable `Raid.season` label plus
the code-defined `RAID_SEASONS`, and an older-season raid may still be sold (bundles,
Run Setups, already planned Runs). Archiving closes every product that contains the raid,
so doing it implicitly could silently break live planning. Older seasons drop out of the
default view anyway; archiving stays an explicit admin action.

#### Raid lifecycle

**Identity** is the Blizzard journal instance id. Import / refresh reuse the Raid holding
that id (one Raid per instance, serialized by an advisory lock), and the insert-only
bootstrap (`ensureReferenceRaids`) skips a fixture raid whose instance already belongs to
another Raid row. Comparing only fixture UUIDs once inserted a second copy of an existing
raid, and the lockout sync then wrote every lockout twice; **Remove duplicate** below is
the repair for such a row.

Raid → Manage offers exactly the action the server accepts in the current state:

| State | Action |
| --- | --- |
| No Run, Run Setup, Product or lockout reference, not a bootstrap fixture | **Delete** — removed with its bosses |
| Shares its Blizzard instance with a Raid that outranks it (more Run / Run Setup / Product references, then lockouts) and has no Run / Run Setup / Product reference itself | **Remove duplicate** — its lockouts move to the kept Raid (exact copies for the same Character / difficulty / reset are dropped, killed boss ids re-mapped), then it is deleted, in one transaction |
| Referenced, or a bootstrap fixture | **Archive** (`Raid.archivedAt`) |
| Archived | **Restore** |

An archived Raid stays valid for existing Runs, lockouts and Warcraft Logs (rows and
foreign keys untouched; lockout sync still follows *Lockout tracking*). It is never
offered for new planning: not available for new Runs (`availableForRuns` is false), a
Run Setup with it is unusable, a product holding it is closed to new Runs / Run Setups,
and it cannot be added to a product (a product that already holds it stays editable).
Run / Run Setup / Product references are never re-pointed or deleted by any of these actions.

### Run Setups

A **Run Setup** (model `RunTemplate`, older code and routes say "template") is a global, reusable planning preset: *what* a Run contains plus default composition. It has no Raid Lead; the Schedule slot or the Run chooses *who*.

- **Stored:** `name`, `difficulty`, `lootType`, desired Tank / Healer / DPS / Lootbuddy counts, `notes`, `isActive`, the audit fields `createdById` / `updatedById`, and ordered `RunTemplateRaidContent` rows. Never a schedule, status, `signupsOpen`, derived title, roster state or Discord identifier.
- **Content** is chosen as a persisted Product (same authority as Create Run), so a Run Setup may hold several raids.
- **Permissions:** ADMIN / OWNER create, edit, duplicate, deactivate, reactivate and delete (`requireManageTemplates`; the Community Schedule actions also manage them). RAID_LEAD and above may list and use active, usable setups (`requireCanUseTemplates`). USER has no access. `/manage/templates` is the ADMIN view, `/profile/templates` a read-only catalog for Raid Leads.
- **Usability** is computed, never stored (`computeUsability`): active; difficulty and run type still valid; composition within bounds; content still covered by an active Product (same raids in order, FIXED counts equal, VARIABLE counts in range; `selectable` is not required) or every content raid still available for new Runs. An unusable setup is never changed or removed; it is only excluded from use and flagged.
- **Use at Create Run:** `createManyRuns` accepts an optional `templateId`. The server re-resolves it at submit time and refuses a missing or unusable setup (`RUN_TEMPLATE_NOT_FOUND`, `RUN_TEMPLATE_UNUSABLE`). Every other Run creation rule still applies.
- **Validation reuse:** create and edit use the same validators as Run creation (`assertValidRunLootType`, `assertValidPlannedBossCount`, `assertComposition`, `notesValue`) from `src/domain/run-state.ts`.
- **Snapshot independence:** there is no `Run.templateId`. Applying a setup copies its values into the Run. Editing or deactivating a setup never changes an existing Run.
- **No recurrence here:** recurring creation is the [Community Schedule](#community-schedule); a setup never creates a Run on its own. A freshly created Run is `DRAFT` with `signupsOpen: false` and has no Discord infrastructure.

### Community Schedule

Authority (unchanged):

- **Run Setup** (`RunTemplate`) = WHAT + default composition
- **Schedule slot** (`CommunityScheduleSlot`) = WHEN + WHO + optional composition override + **start boundary**
- **Concrete Run** = independent operational snapshot — never rewritten by Schedule, Run Setup, Product or composition changes

#### Occurrence identity

One occurrence = **slot + raid-ID window** (`CommunityScheduleRun`, `UNIQUE(scheduleSlotId, windowStartAt)`;
`windowStartAt` = Wednesday 06:00 Europe/Berlin, DST-safe). `runId` is `UNIQUE`, so a Run belongs to at most
one occurrence. An occurrence is fulfilled in one of two ways (`origin`):

| origin | meaning |
| --- | --- |
| `MATERIALIZED` | Run created for this occurrence from the Run Setup (weekly Draft release, or manual **Create Run**) |
| `ATTACHED` | an existing, independently created Run adopted as this occurrence (**Use existing Run**) — provenance only, nothing is copied |

Both share the same unique constraints, so a materializer pass and an attach racing for the same occurrence end with
exactly one fulfillment (the loser rolls back / gets *already fulfilled*).

#### Weekly Draft release

Automatic materialization runs **only** at the weekly release: **Monday 12:00 Europe/Berlin**
(`boostinghub-community-schedule.timer`, `OnCalendar=Mon *-*-* 12:00:00 Europe/Berlin`, `Persistent=true`). Each pass
creates the Drafts of the raid ID starting the **following Wednesday 06:00** for every active slot with
*Automatically create weekly Draft* on (`scheduleDraftRelease` / `releasedWindow`). A pass at any other time (catch-up
after downtime, a manual `systemctl start`) targets the same released raid ID — never the one after it — and is
idempotent (one Run per occurrence).

Saving a Schedule (create, add times, edit, enable auto-create, reactivate) **never** creates Runs. An earlier Draft is
created only by the manual **Create Run** (same uniqueness, start boundary and fulfillment checks, origin
`MATERIALIZED`). The Schedule view shows an unfulfilled future occurrence as **Draft planned** with its release time;
if its release already passed (time planned mid-week) it stays without Run until **Create Run**.

#### Ownership and cleanup

Only `origin = MATERIALIZED` **and** `Run.status = DRAFT` is Schedule-owned. When an occurrence goes away —
time deleted, deactivated, weekday / time changed, start moved later, Run Setup deleted — every future Schedule-owned
Draft of the affected occurrences is retired in the **same transaction** as the Schedule change: cancelled from DRAFT
and archived (the Cancel + Archive end state; a Draft has no signups / announcement, so nothing is sent), and its
occurrence is freed (link `scheduleSlotId → null`, exactly like slot deletion) so it never blocks a later release.
A `RUN_SCHEDULE_DRAFT_RETIRED` RunDomainEvent is recorded after commit.

Never touched by Schedule edits: Runs that left DRAFT (open / rostering / published / …) and `ATTACHED` Runs —
no status, time, scope, roster or signup change. No replacement Draft is created eagerly (e.g. Friday → Saturday
creates the Saturday Draft only at the next release or via Create Run). The confirmation dialogs list the
consequences (*N scheduled Draft Run(s) will be archived* / *N active Run(s) will remain unchanged* / *Linked existing
Runs will remain unchanged*).

Concurrency: Schedule mutations, attach and Draft materialization all row-lock the slot first
(`communityScheduleRepository.lockInTx`). The materializer re-checks the locked slot (active, same weekday / time,
start boundary) before inserting Run + link, so an edit and a release pass serialize — no orphan Draft, no duplicate.
The retire step re-checks `DRAFT` under the roster lock, so a Draft opened concurrently is left alone.

#### Start boundary

`CommunityScheduleSlot.firstWindowStartAt` (nullable): raid-ID window of the first occurrence the materializer may
create. `null` = active immediately (legacy behavior). Occurrences in earlier windows are never auto-created (manual
**Create Run** is refused with *not started*, and they cannot be fulfilled by **Use existing Run** either); the
Schedule view shows them as **Before schedule start** with the start date.

**Starts** choices (resolved server-side from `now`, never stored as browser-local datetimes):

| choice | boundary |
| --- | --- |
| Immediately | `null` |
| Next raid ID | the next raid ID (skips a still-upcoming occurrence of the current one) |
| Skip the next occurrence | the raid ID after the first upcoming occurrence |
| From date… | raid ID of the first occurrence starting on/after that Berlin calendar day |

A boundary at or before the first upcoming occurrence is stored as `null`. Changing the start (Edit → Starts; default
**Keep**) only affects future, not-yet-fulfilled occurrences; existing Runs and links are never touched.

#### Schedule source: Run Setup or existing Run (basis Run)

Two different intents — kept apart on purpose:

- **Basis Run** (Create Schedule → *Schedule source: Existing Run*): an existing Run **defines** the new Schedule.
- **Existing Run for one occurrence** (an additional time, Add times, the Schedule view): the Run only **satisfies**
  that occurrence and never redefines the Schedule.

With source *Existing Run* the request carries `basisRunId`, and the server derives everything from it, in one
transaction with the slots, start boundary and attachment:

| field | derived from the basis Run |
| --- | --- |
| first weekly time | weekday / time of its start in Europe/Berlin (`scheduleTimeOfInstant`) |
| first occurrence | the basis Run itself (`ATTACHED`) |
| Run Setup | see below — no Run Setup selection |
| Raid Lead | its Raid Lead — only if still eligible, otherwise the user must choose (the only manual step) |

Run Setup: a Run has no Run Setup reference (no `RunTemplate` FK; Schedule-created Runs are linked through
`CommunityScheduleRun` and are therefore never attachable again), so there is no provenance to follow. The Run's own
planning snapshot decides: an active, usable Run Setup with **exactly** the same planning fields (difficulty, loot,
ordered `RunRaidContent` incl. boss counts, planned composition) is reused; otherwise **one** new Run Setup is created
from that snapshot (`RunRaidContent` → `RunTemplateRaidContent`, `desired*Count`; never roster / signups, never a
Product guess). One-time copy, no live coupling in either direction.

`basisWeekday` / `basisLocalStartTime`, `raidLeadId` and `runSetup` are optional **future** overrides (the dialog only
sends values the user changed); the basis Run keeps its own time, Raid Lead, scope and roster. Further weekly times are
optional and use the Schedule's Run Setup / Raid Lead. With source *Run Setup*, `runSetup` and `raidLeadId` are
required; an existing Run on a time is attach-only. Basis candidates are all upcoming, unarchived, attachable,
unlinked Runs (no raid-ID window limit) on/after the chosen **Starts**; the list is reloaded on every dialog opening.
No Run is created on save (Monday release unchanged).

**Add times** has no basis semantics: an existing Run takes over that time's weekday / time and is attached; the
group's Run Setup and Raid Lead stay authoritative. On an **existing** Schedule, **Use existing Run** attaches only;
the Run's Run Setup is used for future occurrences only with the explicit option *Also use this Run's setup for future
occurrences*.

#### Use existing Run

- **Create Schedule / Add times**: per weekly time, **First occurrence** = *Create normally* or *Use existing Run* (see
  above). The link is written in the same transaction as the slot. The picker only offers Runs on/after the chosen
  **Starts**.
- **Schedule view**: **Use existing Run** on any upcoming, unfulfilled occurrence on/after the start boundary.
  An occurrence before the boundary is refused with `COMMUNITY_SCHEDULE_NOT_STARTED`.

One service (`community-schedule-occurrence.service.ts`, `attachExistingRunInTx`) backs both. Eligible Runs: not
archived, `DRAFT` / `OPEN` / `ROSTERING` / `PUBLISHED`, not linked to any occurrence, start inside a current or future
raid ID. The occurrence is the slot's occurrence in the **Run's** raid ID. Differences are warnings only (start time,
difficulty, raid scope vs the Run Setup, Raid Lead) — the Run keeps its own values; later occurrences still use the Run
Setup. Attaching records a `RUN_SCHEDULE_ATTACHED` RunDomainEvent. Detach is not offered.

### Run management

#### Runs: Purpose

Real production Run creation and lifecycle management so raid leads and admins do not depend on seeded Run rows.

```text
RAID_LEAD / ADMIN
  → Create draft
  → Configure
  → Open Run
  → Accept signups
  → Close / reopen signup window
  → Roster through existing Roster Management
  → Publish through existing RosterService
  → Cancel when necessary
```

Canonical entity URL remains `/runs/[runId]`. There is no second Run-management detail page.

#### Runs: Authorization

| Account | Create | Edit / open / signup window / cancel |
| --- | --- | --- |
| `USER` | No | No |
| `RAID_LEAD` | Yes, only with themselves as raid lead | Assigned runs only |
| `ADMIN` | Yes, may assign an eligible raid lead (`RAID_LEAD` or `ADMIN`) | Any run |

Raid lead identity is taken from the session for `RAID_LEAD`. Client-supplied `raidLeadId` cannot forge another leader. Admin assignment is validated server-side against active management accounts. Ordinary `USER` accounts cannot become raid lead through form data.

Button visibility is not authorization.

#### Creation

**One canonical workflow, 1–25 drafts.** Route: `/runs/create` (operational Runs hub). There is no separate "single create" vs. "mass create" UI — the same page and the same server action handle a Raid Lead preparing one Run for tonight and an Admin preparing a whole week at once. Same authorization as every other manager action (`RAID_LEAD`/`ADMIN`, enforced server-side regardless of navigation). Legacy `/manage/runs/create` and `/manage/runs/create-many` redirect here.

**Creation products** (not raw Raid rows): any active, selectable `Product` from the Raid Catalog (`productId` plus per-content boss counts, FIXED or VARIABLE per content). Each draft persists authoritative `RunRaidContent` rows only — there is no singular `Run.raidId` / `Run.plannedBossCount` mirror.

**Model**: shared defaults (product/preset, difficulty, loot type, raid lead, composition, Venomous planned boss count, notes) + one row per concrete run, each with its own required `scheduledStartAt` and optional per-field overrides, submitted once. The page starts with exactly one staged row — the ordinary one-off experience — and a manager only sees more than one if they explicitly click Add Run or Duplicate. This is a convenience for preparing concrete runs — **not** a recurrence engine; there is no weekly/RRULE templating or scheduled-generation job, and each row is one specific run a manager already has in mind.

**Bounds**: 1–25 runs per request, enforced client-side for UX and authoritatively server-side (`createManyRunsSchema`). 0 or 26+ rows are rejected with a clear message, never silently truncated.

**Shared preparation path**: `run.service.ts` extracts `resolveRequestedRaidLeadId` (RAID_LEAD self-only vs ADMIN-must-choose) and `prepareRunDraft` (schedule/composition/loot-type/boss-count validation + server title derivation via `buildRunTitle`) into functions `createManyRuns` uses for every row — a 1-row submission and a 25-row submission both flow through the exact same `createManyRuns` → `prepareRunDraft` path, never a forked implementation for the "single" case. `title` is never accepted from the client. (`runService.createRun`/`getCreateForm` — the original single-Run methods — still exist and are exercised directly by the Service-level test suite, but no product UI calls them anymore; the canonical page always uses the generalized action, even for one row.)

**Row overrides**: every field is "override present → use it, else inherit the shared default" except `notes`, which is three-valued: override key absent → inherit shared notes; override `null` → explicitly clear this row's notes even though a shared value exists; override a string → use it. A row overriding `raidId` or `difficulty` is validated against *that row's own* effective raid/difficulty — `plannedBossCount`, for example, is checked against the overridden raid's real boss total, never the shared default raid's.

**Batched lookups**: raid and eligible-raid-lead resolution are each one query for the whole batch (`raidRepository.listByIds`, `userRepository.listEligibleRaidLeads`), not one query per row — the maximum is only 25, but this avoids an obvious N+1 regardless.

**Validate everything, then write once**: every row is fully merged and validated before any persistence is attempted. The first invalid row aborts the whole submission with `Run <n>: <reason>` (1-based, matching the row's position in the request) — including reusing `RAID_NOT_AVAILABLE_FOR_RUNS` when any row (via defaults or an override) targets a raid with `availableForRuns: false` (see [§ Historical raid availability](#historical-raid-availability)).

**Atomicity**: `runRepository.createManyDraftsAtomic` persists every row's `Run` + `RunRaidContent` set and its initial empty `RunRoster` inside one database transaction — genuinely all-or-nothing, whether the request has 1 row or 25. A fault partway through (e.g. invalid content `raidId` on a later row) rolls back every row already written in that same call, never leaving a partial result.

**Result**: every created run is `DRAFT`, `signupsOpen: false`, not archived. No Discord infrastructure is touched (no `RunDiscordPost`, no channel, no message) — a fresh Draft is invisible to `discordSyncService.listSyncWork()` until it is opened normally, one Run at a time, from Manage Runs or the run's own page. Creation never shortcuts opening or publishing.

**Activity**: one summary `RUN_CREATED` Activity row per successful submission ("Created N run draft(s)."), never one row per created run.

**Legacy URLs**: `/manage/runs/create` and `/manage/runs/create-many` redirect to `/runs/create` rather than rendering a second form, so old links/bookmarks still work.

**After success**: one draft navigates to its canonical detail (`/runs/[runId]`); multiple drafts navigate to `/manage/runs?massCreated=N` so every new DRAFT is visible under Manage Runs. Cancel returns to `/runs`.

**Run Setups**: `createManyRuns` accepts an optional `templateId` for a usable global Run Setup. The server re-resolves it at submit time (`runTemplateService.resolveTemplateForUse`) and copies its ordered contents into the Run. A Run Setup has no Raid Lead; the Raid Lead is chosen on the Run or Schedule. See [Run Setups](#run-setups).

#### Derived identity (title, run type, boss coverage)

There is no title input on Create or Edit — `Run.title` is always server-derived from the schedule, difficulty, run type (`lootType`), content coverage token (`titleCoverage` from `projectRunContentDisplay`), and raid lead. Difficulty display is `NM` / `HC` / `Mythic`; run-type labels are `Saved` / `Unsaved` / `VIP` / `Community`. See [Run](#run) for the full format, the `RunLootType` compatibility matrix (`MYTHIC + SAVED` rejected; `COMMUNITY` allowed on every difficulty), and how Discord channel naming reuses the same structured coverage projection (`mythic` / `com` tokens). Creation (above) reuses this exact same structured validation and title-generation path per row, never a duplicate implementation.

#### Run lifecycle responsibilities

| Operation | Owner |
| --- | --- |
| Create draft, edit planning, `DRAFT → OPEN`, signup window, cancel | Run Management (`RunService`) |
| `OPEN → ROSTERING` on first persisted draft selection | Roster Management (`RosterService`) |
| `ROSTERING → PUBLISHED` on publish | Roster Management (`RosterService`) |
| `PUBLISHED → IN_PROGRESS` / `IN_PROGRESS → COMPLETED` | Run lifecycle + attendance (`RunService` + `AttendanceService`) |

Do not send an arbitrary status from the client. Transitions are explicit domain operations.

#### Signup window

`RunStatus` is not `signupsOpen`.

A run may be `OPEN`, `ROSTERING`, or `PUBLISHED` with `signupsOpen = false`. Closing the window does not withdraw signups, change `SELECTED`, delete rows, or alter roster / BoosterAccess.

- **Open Run** (`DRAFT → OPEN`) sets `signupsOpen = true` atomically.
- **Close Signups** / **Reopen Signups** are allowed on `OPEN`, `ROSTERING`, and `PUBLISHED` (until Start).
- Drafts use **Open Run**, not Reopen.
- Publishing the roster does **not** close signup registration — `signupsOpen` stays whatever the Raid Lead set.
- `IN_PROGRESS`, `COMPLETED`, and `CANCELLED` cannot reopen signups. Start Run atomically sets `signupsOpen = false`.

#### Editability matrix

Centralized in `getRunLifecycleCapabilities` (`src/domain/run-state.ts`). Views render server flags.

| Status | Raid / difficulty / content / bosses | Schedule / loot / composition / notes / role ping | Raid lead reassignment |
| --- | --- | --- | --- |
| `DRAFT` | Editable | Editable | ADMIN only |
| `OPEN` (with or without signups) | Editable | Editable | ADMIN only |
| `ROSTERING` | Editable | Editable | ADMIN only |
| `PUBLISHED` | Editable | Editable | ADMIN only |
| `IN_PROGRESS` | Locked | Locked | Locked |
| `COMPLETED` | Locked | Locked | Locked |
| `CANCELLED` | Locked | Locked | Locked |

The rule is a single predicate, `canEditRunBeforeStart(status)` (`PRE_START_RUN_STATUSES`): a Run is editable until **Start Run**. Edit Run is available in `PUBLISHED` too. Server-side every edit returns `RUN_EDIT_LOCKED` once the Run has started, independent of what the UI showed. `MYTHIC` + `SAVED` stays invalid.

#### Signup history does not freeze the Run

Existing signups (including `WITHDRAWN`) no longer lock raid / content / difficulty. Changing them keeps every signup, offered role and the saved/published selection; nothing is silently deleted or auto-deselected. Eligibility (the owner's Booster role, lockouts, reservations, schedule conflicts, composition) is recalculated from the current Run state everywhere it is evaluated — roster builder, Update / Publish Roster, Add Booster and Start. The Booster role is account-level and not scoped by difficulty, so changing a Run from Normal to Heroic never invalidates a selected Booster; revoking a selected player's Booster role does — the roster then shows the blocker, Update Roster refuses the invalid lineup and Start is blocked until the lead replaces the player and updates the roster.

**Roster acknowledgement.** When a roster was already published, a roster-relevant edit — difficulty, raid content, planned boss count, schedule, loot type, or desired Tank/Healer/DPS counts — sets `RunRoster.runChangedSinceAck = true` in the same transaction. The published roster then shows "Run details changed since the roster was last published" and counts as having unpublished changes, so Start is refused until **Update Roster** (or the first Publish) acknowledges the change and clears the flag. Notes, the Discord role-ping flag and Raid Lead reassignment do not set it. Before the first publish nothing is set — the first Publish validates the current Run anyway.

**Edit vs Start.** The Run edit transaction (`runRepository.updatePreStartAtomic`) locks the `RunRoster` row first — the same lock order as roster writes and Start — then re-reads the Run and refuses unless it is still pre-start. An edit that commits before Start marks the roster changed (Start then refuses); an edit that waits behind Start fails with `RUN_EDIT_LOCKED` and changes nothing.

#### Raid lead reassignment

- `RAID_LEAD` cannot reassign their run.
- `ADMIN` may reassign throughout the pre-start lifecycle: `DRAFT`, `OPEN`, `ROSTERING` and `PUBLISHED`. Locked from `IN_PROGRESS`.
- Target must be an eligible active `RAID_LEAD` or `ADMIN`.
- Reassignment changes who may manage the run and is enforced in `RunService`. It does not mark the roster changed; the roster version is bumped so the current Discord roster post (whose title names the Raid Lead) is refreshed in place.

#### Cancellation

Explicit **Cancel Run** with an application confirmation dialog (not `window.confirm`).

Allowed from `DRAFT`, `OPEN`, `ROSTERING`, `PUBLISHED`.

Not allowed from `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`.

Effects (authoritative cancel transaction):

- snapshot `cancelledFromStatus` / `cancelledFromSignupsOpen` from the current Run
- bump `cancelRevision` (monotonic; identities cancel/reactivate notification cycles)
- `status = CANCELLED`
- `signupsOpen = false`
- insert `RUN_CANCELLED` `RunDiscordAnnouncement` in the same transaction

Preserved: Run row, signups, roster, BoosterAccess, lockouts, activity/history, Discord identity until channel retirement.

The only Run delete is ADMIN / OWNER deleting an unused `DRAFT` (`runService.deleteRun`). It is refused with `RUN_CANNOT_DELETE` once the draft has signup or operational history. Every other Run is cancelled and archived, never deleted.

#### Reactivate Run

Pre-start cancellation is reversible. **Reactivate Run** restores the exact lifecycle state captured immediately before Cancel — it is not a status picker and not Archive Restore.

Allowed when:

- `status === CANCELLED`
- `cancelledFromStatus` is `DRAFT` | `OPEN` | `ROSTERING` | `PUBLISHED`
- `archivedAt == null`
- no Start evidence (`RunStartSnapshot`, `RunAttendance`, or `completedAt`)

Legacy CANCELLED rows without a snapshot stay terminal (`canReactivate = false`).

Restore semantics:

| Snapshot | Restored status | Restored `signupsOpen` |
| --- | --- | --- |
| `DRAFT` | `DRAFT` | always `false` |
| `OPEN` / `ROSTERING` / `PUBLISHED` | same | exact snapshotted value |

Also:

- clear snapshot fields (`cancelledFromStatus` / `cancelledFromSignupsOpen`); keep `cancelRevision`
- skip still-PENDING cancel channel announcement + cancel Discord DMs for this revision
- create `RUN_REACTIVATED` channel announcement + participant notifications (revisioned source keys; uses the cancel DM preference as the same lifecycle family)
- clear active Discord archive artifact pointers (historical log messages stay)
- do not recreate deleted Discord IDs; normal provisioning recreates infrastructure when needed
- do not republish roster or re-send `ROSTER_SELECTED`

Archive remains separate: archived CANCELLED → Restore Archive (still CANCELLED) → then Reactivate.

Multiple cancel/reactivate cycles are supported; each cancel bumps `cancelRevision` so announcements and DMs are not suppressed by an earlier cycle.

#### Canonical Run detail

Management actions live on `/runs/[runId]`:

- Edit Run
- Open Run
- Close Signups / Reopen Signups
- Cancel Run
- Reactivate Run (pre-start CANCELLED with snapshot only)
- Start Run / Complete Run (see [Run lifecycle and attendance](#run-lifecycle-and-attendance))

The Run Detail DTO includes server-derived `capabilities`. USER payloads keep `editor` null and capabilities false. USER still sees lifecycle status, signup window, metadata, own participation, and published roster.

#### Manage runs

`/manage/runs` is the managerial index for **existing** Runs (not the home of creation):

- content, difficulty, schedule, raid lead, status, signup window, signup count, roster state
- filters: status, upcoming/past, raid lead (admin)
- empty state: “No runs created yet.”
- row actions open canonical `/runs/[runId]`

**Create Run** lives on `/runs` (header action for RAID_LEAD/ADMIN) and opens `/runs/create`.

#### Runs: Visibility

- **DRAFT** is management-only. `/runs` does not list drafts. USER detail access returns not found. Assigned raid lead and ADMIN may open the draft.
- **CANCELLED** is excluded from signup-oriented discovery. Canonical detail remains for managers and for users with historical participation. My Runs may still show cancelled participation.

#### Raid reference data

Supported raid content lives in `src/lib/wow-raid-catalog.ts` and is upserted by `raidRepository.ensureReferenceRaids()`.

This is **system/reference WoW content**, not demo users or demo Runs. The catalog uses stable identifiers. Dev seed still creates fixture users and example Runs around that content. Run services and UI do not hard-code demo Run IDs.

`ensureReferenceRaids()` is idempotent and is invoked from seed and from Run create/edit option loading so a production install without demo Runs can still create Runs.

##### Historical raid availability

A raid is never deleted when a new content tier replaces it — its `Raid`/`RaidBoss` rows, and every historical Run/lockout relation pointing at it, stay intact and fully readable forever. What changes is whether it can be picked for a **new** Run.

`WowRaidCatalogEntry.availableForRuns` (mapped by `ensureReferenceRaids()` onto the `Raid.isActive` column — no separate column, no migration) is the single source of truth, exposed as `RaidRecord.availableForRuns` and read exclusively through `raidRepository.listAvailableForRuns()` (available raids only) / `raidRepository.findById()` (any raid, including historical). Views never infer availability themselves.

This is a **distinct concept from `currentForLockouts`** (`src/lib/wow-raid-catalog.ts`), which only tells Blizzard lockout derivation which raid's encounters to track. Manaforge Omega is `availableForRuns: false` (historical) today, but the two flags are independent and neither is ever derived from the other — a future raid could in principle be current for lockouts without being open for new Run creation, or vice versa.

Where availability is enforced:

- **Creation** (`getCreateManyForm`, `createManyRuns`, and every row of a batch): the raid picker only lists available raids; the server independently re-validates on submit and rejects an unavailable raid with `RAID_NOT_AVAILABLE_FOR_RUNS` ("This raid is no longer available for new runs.").
- **Edit Run** (`updateRun`): only rejected when the raid is *actually changing* to a different, unavailable one. Keeping an existing (possibly historical) raid — including a difficulty-only change on that same raid, or any unrelated field edit — is never blocked by availability. The Edit Run raid selector always represents the Run's current raid as its selected value (marked "(Historical)" and non-selectable as a fresh alternative when historical) without offering any other historical raid as a replacement.
- **Open Run**: never re-checks raid availability — opening progresses an already-established reference, not a new selection, so a Draft created before a raid became historical can still be opened.

Historical Run reads (`/runs/[runId]`, Discord/embed DTOs, etc.) are unaffected — they resolve the raid by its stable id regardless of availability.

#### Runs: MVCS

View → Controller → Service → Repository.

- No Prisma in views or controllers
- Editability and transitions live in `run-state.ts` / `RunService`
- Controllers authenticate, validate, call `RunService`, map errors, revalidate

#### Runs: Security

- Creator / raid-lead identity is server-derived for `RAID_LEAD`
- Admin assignment is validated server-side
- No client-forged `status` or `signupsOpen`
- No cross-run raid-lead mutation

- Domain errors, not raw Prisma/Postgres errors

#### Runs: Deferred

- Run Setup cron / RRULE generation outside the Community Schedule

### Canonical Run detail

#### Run detail: Purpose

One canonical Run entity view at `/runs/[runId]`.

This is the long-term surface for participant information and, when authorized, Run management. Future Discord/notification links should use this URL, not a management-only path.

#### Route Architecture

All route access rules are in the routes table under [Project structure](#project-structure).

Do not maintain a second independent Run detail implementation under `/manage`.

#### Permission-Aware View

The shared route does **not** mean a shared payload. `runDetailService.getRunDetail` shapes data per viewer.

##### USER

Participant-facing metadata, own signups, and the published roster when one exists.

Must not receive:

- draft selection
- unpublished roster internals
- validation blockers/warnings
- manager mutations
- full attendance list, manager notes, or `markedBy`

Hiding buttons in CSS is not sufficient.

##### RAID_LEAD

May manage only assigned runs (`user.id === run.raidLeadId` and account role `RAID_LEAD` or above; ADMIN / OWNER manage every run).

A raid lead viewing another lead's Run is a normal viewer: no manager DTO, no roster tools.

##### ADMIN

May manage any Run on the same `/runs/[runId]` route.

#### Run detail: Sections

- **Header** — raid, difficulty, schedule, status, raid lead, signup window, compact composition. Server-gated manager actions (edit / open / signup window / cancel / start / complete) live in the bar on the Roster tab
- **Discord channel** — every viewer of the Run: `Discord channel ↗` header link (`https://discord.com/channels/{DISCORD_GUILD_ID}/{runChannelId}`, new tab) while the Run has a recorded Discord channel and is not archived. Absent for DRAFT Runs (no channel), archived Runs (channel retired) or without `DISCORD_GUILD_ID`. Built by `runDiscordChannelUrl` (`src/lib/discord-links.ts`); public ids only. Discord channel permissions still decide what the viewer can open.
- **Archive transcript** — managers only, when HTML was persisted on app-archive: download link to `/runs/[runId]/archive-transcript`
- **Roster** tab (default, `?tab=` selects tabs, `src/components/runs/run-detail-tabs.tsx`) — managers get the administration bar, roster builder and signup tiles; everyone else gets the Run details, own participation and the published roster
- **Operations** tab — Pre-flight and roster validation
- **Attendance** tab — own result for USER; operational attendance for authorized managers after Start
- **History** tab — Run history, managers only
- **Consumables** — ADMIN / the Run's RAID_LEAD only, COMPLETED Runs only: Warcraft Logs consumable, gear-readiness and death-context facts. `consumables` is `null` (and the tab absent) for everyone else. See [Run Consumables Audit](#run-consumables-audit)

#### Manager Authorization

`canManageRun` / `assertCanManageRun` remain the single ownership check.

- Raid lead: assigned Runs only
- Admin: all Runs
- Being listed as `raidLeadId` does not grant a `USER` roster tools

Roster mutations stay on existing roster actions. Views do not decide publish/eligibility/lockout rules.

#### Data Security

`manager` is `null` for viewers who cannot manage. Published roster members are a separate public snapshot of `SELECTED` signups. Draft selection is never copied into that snapshot.

USER reads call `getPublishedRosterView`, which uses `findByRunId` and **does not** `ensure()` a roster row.

Manager reads still reuse `getRosterManagementView`, which may `ensure()` an empty draft. That does not change `RunStatus`.

#### Existing Service Reuse

- `RunService` — run list, create/edit/open/signup window/cancel/start/complete
- `RunDetailService` — viewer DTO orchestration only, including manager capabilities
- `SignupService` — own signups, eligibility, withdraw
- `RosterService` — draft, publish, published snapshot, managed index
- `AttendanceService` — snapshot, status updates, bulk present, completeness
- `runConsumableAuditService` — post-run Warcraft Logs consumables audit (read + explicit analyze)

No second roster or signup implementation.

### Run signups

#### Signups: Purpose

Let a signed-in user persist **Booster** and/or **Lootbuddy** participation for a specific run. Participation type belongs to the signup row, not the account. A User may hold Booster and any number of Lootbuddy entries on the **same** Run simultaneously. Web and Discord are both clients of the same domain — see [Discord bot](#discord-bot).

#### Signup window lifecycle

Authoritative helper: `isSignupWindowOpen(status, signupsOpen)` (`SIGNUP_WINDOW_STATUSES` in `run-state.ts`).

| Run status | Signup registration |
| --- | --- |
| `DRAFT` | Closed |
| `OPEN` | Available when `signupsOpen = true` |
| `ROSTERING` | Available when `signupsOpen = true` |
| `PUBLISHED` | Available when `signupsOpen = true` |
| `IN_PROGRESS` | Closed |
| `COMPLETED` | Closed |
| `CANCELLED` | Closed |

Publishing a roster does **not** close signup registration. Late signups remain `PENDING` until the Raid Lead explicitly updates the roster. The Raid Lead may still manually close/reopen signups on `OPEN` / `ROSTERING` / `PUBLISHED`. **Start Run** is the lifecycle freeze point and atomically sets `signupsOpen = false`.

#### Participation identity

Where multiplicity matters, identity is `RunSignup.id` — not `userId`, not class, not class+mode, and not `characterId`.

#### Booster offers (Character-backed)

Each BOOSTER `RunSignup` row is one offered Character. Unique key `(runId, userId, characterId, participationType)` allows several BOOSTER Characters per User+Run.

`signupService.setCharacterOffers(actor, { runId, offers })` is **BOOSTER-only**:

- **Set semantics, not additive.** The `offers` array is the complete desired BOOSTER set. Omitting a currently-offered Character withdraws it; a `WITHDRAWN` row matching a re-offered Character is reactivated in place rather than duplicated.
- **Never touches Lootbuddy rows.** Updating Booster offers must not withdraw Lootbuddies.
- **All-or-nothing.** If any offered Character fails eligibility, or any removal is protected, the whole call is rejected.
- **Role is a per-Character User choice, bounded by class — not fixed to specialization.** See "Booster signup role" below.

Removal protection: a `PENDING` offer may always be withdrawn while lifecycle rules allow editing. An offer currently selected on the **Roster tab's draft** cannot be silently withdrawn (`SIGNUP_OFFER_ROSTER_SELECTED`). A `SELECTED` offer after `PUBLISHED` follows the existing self-withdraw lock.

`signupService.cancelBoosterSignup(actor, { runId })` withdraws the User's entire active BOOSTER set — never Lootbuddies.

##### Quick Signup (Booster-only accelerator)

`signupService.quickSignupBoosters(actor, { runId })` adds every **currently eligible** Booster Character that has a non-null specialization `defaultRole`, using `offeredRoles: [defaultRole]`.

**Product rule:** Quick Signup offers all of your eligible Booster characters. Saved characters and characters used in non-conflicting runs are included. Characters marked unavailable or reserved for a conflicting run are skipped.

- **Additive.** Existing active Booster offers (and their `offeredRoles`) are preserved unchanged — including draft-selected and published `SELECTED` rows. Quick Signup never withdraws and never overwrites roles.
- **Same eligibility authority** as the Signup dialog (`evaluateBoosterOptions` via `withSignupEligibilityContext` / reservation collision). Raid lockouts / saved progress remain informational only (`contentSaves`) — a saved Character is still added when otherwise eligible. A mere `PENDING` offer on another Run does **not** reserve the Character.
- **Conflicting reservation only.** A Character is skipped for scheduling when it is draft-selected or `SELECTED` on another upcoming Run whose start is **strictly less than** 2 hours from this Run (`CROSS_RUN_RESERVATION_MIN_GAP_MS`). Exactly 2 hours apart is allowed.
- **Weekly unavailable / inactive.** Deliberate Character weekly unavailability and inactive Characters are hard skips (same as manual eligibility).
- **No role guessing.** Characters with `defaultRole: null` (missing/unrecognized specialization) are skipped by Quick Signup only; the User can still add them manually and choose a role.
- **Server-side merge.** The current active Booster offer set is loaded at execution time — the client does not supply a complete desired set — so a stale client cannot wipe existing offers. Idempotent: a second click with no state change adds 0. Race safety: `validateOfferedCharacters` then `applyOfferPlan`'s transactional `queryReservationConflicts` re-check before create/reactivate.
- **Result breakdown.** `added`, `alreadySigned`, `skippedNoDefaultRole`, `skippedUnavailable`, `skippedReservationConflict`, `skippedInactive`, plus additive `skippedIneligible`.
- **Never touches Lootbuddies.**
- Works for Normal / Heroic / Mythic and for Saved / Unsaved / VIP / Community alike (`MYTHIC + SAVED` remains invalid at Run level).

**UI placement:** Discord Signup embed only (button label **Quick Sign**). Web keeps manual Booster Character selection + **Save Booster Offers**; it does not expose Quick Signup. The domain service is shared application logic.

#### Lootbuddy entries (characterless)

New Lootbuddy signups do **not** require a Character under `/characters`. Required fields:

- `lootbuddyClass` (`WowClass`)
- `lootbuddyMode` (`LOOT_ONLY` → "Loot only" | `PLAYING` → "Play along")
- optional `lootbuddyVerification` (`NONE` | `ACCESS` | `TRIAL`) — metadata, not an approval workflow

`characterId` is `null` for new rows. Do not create fake Character rows.

`signupService.setLootbuddies(actor, { runId, lootbuddies })` reconciles the desired Lootbuddy set by `signupId`:

- `signupId` present → retain/update that owned row
- `signupId` absent → create a new row (always insert; never revive by natural key)
- active Lootbuddy omitted from the desired set → withdraw (subject to roster/lifecycle protection)
- **Never touches Booster rows**

Identical Class+Mode pairs are allowed as two distinct `RunSignup` ids.

##### Legacy Character-backed Lootbuddy

Historical rows may have `participationType = LOOTBUDDY`, `characterId != null`, `lootbuddyClass = null`. They remain readable. Display class fallback:

```text
signup.lootbuddyClass ?? signup.character?.wowClass ?? null
```

No destructive backfill.

#### Coexistence

On one Run, a User may simultaneously have:

- one Booster participation (the selected/offered Booster Character workflow), and
- zero to N Lootbuddy participations

Updating one side never clears the other. Removing one Lootbuddy does not affect Booster or other Lootbuddies. Web **Cancel Booster** (`cancelBoosterSignup`) does not remove Lootbuddies. Discord **Unsign** (`withdrawFromRun`) withdraws both Booster and Lootbuddy. Clearing all Lootbuddies does not remove Booster.

#### User flow (Web)

1. Open `/runs` or `/runs/[runId]` → **Sign up**.
2. **Booster** section (optional): select Characters + roles. Requires owned active Characters and the account-level Booster role (`User.isBooster`, any run difficulty). For one-click all-eligible signup, use the Discord **Quick Sign** button instead.
3. **Lootbuddies** section (optional, independent): add N entries with Class + Mode. No Character selector. Zero-character Users may still sign as Lootbuddy.
4. Save each section separately (`setCharacterOffers` / `setLootbuddies`).
5. Review on `/my-runs` or the Run page — both participation types can appear for the same Run.

##### My Runs (`/my-runs`)

Top-level groups stay **Selected / Pending / Not Selected / Withdrawn** (raid-ID filter `?id=` applies to all of them), each listing the User's participations grouped by Run. The Run block shows the Run title, the compact raid title (`contentShortTitle`, e.g. `Venom & Tide & Kithix`) and the difficulty.

When a Run in **Pending** also has selected participation(s) of the same User (draft or published — the same authority as the Selected group, `selectionState` `DRAFT` / `PUBLISHED`), its Pending block starts with read-only context:

```
SELECTED FOR THIS RUN
<role icon> Alt-Realm · Healer · Selected · Draft
PENDING ALTERNATIVES · 4
  …the 4 pending offers, each with its own Withdraw…
```

The selected row itself stays in **Selected** (never repeated as a pending row) and carries no action in the context. Several selected participations are all listed — the domain allows one Booster plus any number of Lootbuddies per User and Run (and two Boosters can coexist in a draft until publish validation blocks it). Helper: `groupMyRunsByRun` (`src/lib/my-runs-groups.ts`).

#### Booster offered roles vs selected role

These are different domain facts:

| Concept | Storage | Meaning |
| --- | --- | --- |
| **Offered roles** | `RunSignupRole` (`RunSignup.offeredRoles`) | Roles the Booster volunteers this Character can play for this Run (1+) |
| **Selected role** | `RunRosterEntry.selectedRole` | The single final role the Raid Lead assigns in the roster |

A Character's specialization (`roleForSpecialization`) determines only the **default** hint in Web/Discord — never a restriction. The allowed offered set is everything the Character's *class* can perform (`rolesForClass` / `isRoleValidForClass`). Offering roles never mutates `Character.specialization` or `Character.primaryRole`.

`setCharacterOffers` takes `{ characterId, offeredRoles: CharacterRole[] }` (deterministic order TANK → HEALER → DPS, ≥1, class-validated). One Character remains one `RunSignup` row even when volunteering multiple roles.

If a signup is already draft-selected with `selectedRole = X` and the Booster removes `X` from offered roles, the offer update is **rejected** — the Raid Lead must change the roster first.

#### Participation types

- `BOOSTER` — Character-backed. Needs the owner's Booster role (`User.isBooster`, not scoped by run difficulty), plus character/lockout/reservation rules.
- `LOOTBUDDY` — Class + Mode. Does **not** require a Character for new signups. Does **not** require the Booster role, and is not gated by the Lootbuddy role (`User.isLootbuddy` is management/display only).

#### Booster signup eligibility

Required: run, user (server session), character, role, `isBackup`, status `PENDING`.

1. Character belongs to the current user
2. Character is active
3. The User holds the Booster role (`User.isBooster`, valid for every run difficulty)
4. Offered role is valid for the character's class
5. Progress lockouts are informational only (never a hard blocker at signup). Target reset is the Character region's regional WoW reset window containing `Run.scheduledStartAt` (`lockoutService.getResetIdentifierForRun`). Verified `0/x` is Unsaved; missing row is Unknown. `UNSAVED` and `VIP` share fresh-lockout attention presentation.
6. Run signup window is open (`OPEN` / `ROSTERING` / `PUBLISHED` **and** `signupsOpen`)
7. No active duplicate for run + user + character + BOOSTER
8. Cross-run Character reservation (BOOSTER only): a Character that is **draft-selected** or **SELECTED** on another upcoming Run blocks reuse when that Run's `scheduledStartAt` is **less than 2 hours** from the target Run's start (`Math.abs(Δt) < 2h`). Exact **2 hours or more** is allowed. Comparison is symmetric on absolute start timestamps — there is **no** Run-duration / end-time model. Same-Run self-edits are excluded. Mere PENDING offers (not draft-selected / SELECTED) do not reserve. Characterless Lootbuddies are unaffected. Raid lockouts remain informational and never hard-block.

##### Run commitment vs schedule conflict

These are separate derived projections:

| Concept | Question | Blocks selection / publish? |
| --- | --- | --- |
| **Run commitment** | Is this Character already draft-selected or published SELECTED on another upcoming BoostingHub Run? | **No** — informational only (`RESERVED` / `COMMITTED`). Roster UI: **Draft roster** (danger) / **Published roster** (warning). |
| **Schedule conflict** | Does another reserving Run violate the 2-hour start gap (or weekly unavailability)? | **Yes** — existing blocker semantics (strong danger alert in Roster Builder) |

A Character may be committed elsewhere with **no** schedule conflict (e.g. other Run ≥ 2h away). Roster Builder still shows the commitment so Raid Leads see context without inventing a broader blocker.

Commitment authority reuses the same reserving predicate as reservation (draft-selected **or** `SELECTED`). `COMPLETED` / `CANCELLED` Runs do not hold commitments. While a published Run has a replacement draft being edited, the live `SELECTED` row remains `COMMITTED` until a successful republish.

#### Lootbuddy signup eligibility

Required: `lootbuddyClass`, `lootbuddyMode`. Character optional (legacy only).

- No `/characters` requirement for new entries
- Signup window must be open when creating/reactivating entries
- Protected roster-selected / published-locked rows cannot be illegally withdrawn (atomic reject)

#### Signup lifecycle

Independent of run status.

| Status | Meaning |
| --- | --- |
| `PENDING` | Player offer, waiting for roster |
| `SELECTED` | Roster outcome (not player-chosen) |
| `NOT_SELECTED` | Roster outcome, kept as history |
| `WITHDRAWN` | Player left the offer; row remains |

#### Withdrawal

Computed by `canSelfWithdrawSignup` in `signup-state.ts`. The view only renders the button when the service says `canWithdraw`.

- Own `PENDING` signup: withdrawable while the run is not completed/cancelled
- Own `SELECTED` signup: withdrawable only **before** `PUBLISHED` / `IN_PROGRESS` / `COMPLETED`
- `NOT_SELECTED` and `WITHDRAWN`: not self-withdrawable
- Another user's signup: `NOT_AUTHORIZED`

Prefer clear actions: **Cancel Booster Signup**, **Remove/Edit Lootbuddies** via `setLootbuddies`. Per-row withdraw remains available where lifecycle allows.

##### Picked players withdraw with a reason

A **picked** signup (`SELECTED` on the published roster, or in the saved roster draft — see `isPickedSignup`) can withdraw only with a **reason** (3–300 chars), and only until the Run starts (`OPEN` / `ROSTERING` / `PUBLISHED`). After Start Run the Raid Lead replaces no-shows instead.

- Web: the signup's **Withdraw** button asks for the reason (`canWithdrawWithReason` → `withdrawPickedSignupAction`). A plain withdraw of a picked row answers `WITHDRAW_REASON_REQUIRED` and the button switches to the reason form. All other withdrawal paths (offer edit, Cancel Booster, Lootbuddy edit) still refuse picked rows.
- Discord: **Unsign** opens a reason modal for a picked User (see [Discord bot](#discord-bot)).
- Effect (one transaction, `withdrawPickedSignupAtomic`): signup → `WITHDRAWN` with `withdrawReason` stored, its roster entry removed (slot free), roster version bumped (Discord signup/roster posts refresh), and a `ROSTER_WITHDRAWN` notification to the Run's Raid Lead with the reason and a link to the Roster tab (web + Discord DM; master DM toggle and Quiet Hours apply). The player gets no "removed" DM.
- Re-offering the same Character later clears the old `withdrawReason`.

#### Duplicate rules

Unique key: `(runId, userId, characterId, participationType)`.

PostgreSQL treats `NULL` `characterId` values as distinct for uniqueness, so multiple characterless LOOTBUDDY rows for the same User+Run are allowed.

Role is stored on the booster row but is not a uniqueness dimension.

#### Counts

Run signup counts exclude `WITHDRAWN` rows. Selected counts are `SELECTED` only. The Discord signup embed's count is the number of **distinct Users** with an active signup, never the number of `RunSignup` rows — see [Discord bot](#discord-bot).

#### Signups: Architecture

- View: `/runs` dialog (independent Booster + Lootbuddy sections; manual Booster offers), signup lists on the `/runs/[runId]` Roster tab, `/my-runs`
- Controller: `src/controllers/signup.actions.ts` (`setCharacterOffersAction`, `setLootbuddiesAction`, …)
- Service: `signupService` (`setCharacterOffers`, `quickSignupBoosters`, `setLootbuddies`, `cancelBoosterSignup`) + `signup-eligibility.ts` + `signup-state.ts` (`planCharacterOfferReconciliation`, `planLootbuddyReconciliation`)
- Repository: `signup.repository.ts` (`applyOfferPlan`, `applyLootbuddyPlan`)
- Model: `RunSignup` (`lootbuddyClass` optional; `characterId` nullable)
- Discord: `src/discord-bot/*` via `/api/bot/*` — see [Discord bot](#discord-bot). Quick Signup is Discord-only UI, labelled **Quick Sign** (`POST /api/bot/runs/:runId/signup/quick` → `quickSignupBoosters`); resulting rows are normal Booster offers.

Granting and revoking the Booster role: [Boosting Roles](#boosting-roles).

#### Signups: Deferred

Preferred/ranked Character among offers, User-level time-window collision for characterless Lootbuddy.

### Roster management

#### Roster: Purpose

Let a **raid lead** or **admin** build a persistent draft roster for a run, validate it, and publish it. Publication writes final `RunSignup` statuses and moves the run to `PUBLISHED`.

This is internal operations tooling. It is not raid-group assignment or attendance marking. Attendance after Start is documented in [Run lifecycle and attendance](#run-lifecycle-and-attendance).

Canonical Run URL: `/runs/[runId]`. See [Canonical Run detail](#canonical-run-detail). Run create/open/cancel: [Run management](#run-management).

#### Roster: Roles

| Account role | Roster access |
| --- | --- |
| `USER` | None. `/manage` redirects. Service mutations throw `RUN_NOT_MANAGEABLE`. |
| `RAID_LEAD` | Only runs where `user.id === run.raidLeadId`. |
| `ADMIN` / `OWNER` | Every run. |

Account roles are not booster/lootbuddy identities. `BOOSTER` and `LOOTBUDDY` remain signup participation types.

#### Run ownership

`canManageRun` / `assertCanManageRun` in `src/auth/authorization.ts` are the single ownership check.

- Being listed as `raidLeadId` does not grant a `USER` roster tools.
- A raid lead cannot roster another lead's run.
- Views do not re-implement this rule; they render data the service already authorized.

#### Draft roster

Draft selection is **not** `RunSignup.status`. Card clicks must not immediately become public `SELECTED`.

The Roster Builder stages draft selection **locally**, including each BOOSTER's `selectedRole`. Clicking signup cards toggles the staged set without a server round-trip. **Save Roster** persists the full staged selections (`{ signupId, selectedRole }[]`) in one mutation (`saveDraftSelection` / `saveRosterDraftAction`), bumps `version` once, then refreshes. Composition, Class Buffs, and Validation continue to reflect the **saved** draft until that Save. Publish stays disabled while the staged set is dirty.

Each run has at most one `RunRoster` row:

- `state` is `DRAFT` until the first successful publish, then `PUBLISHED` even while a replacement draft is edited
- `version` increments on draft writes and on publish (stale clients get `ROSTER_ALREADY_CHANGED`)
- `publishedAt` / `publishedById` are set on successful publish

`RunRosterEntry` stores **currently draft-selected** signups (`selected = true`) plus the Raid Lead's final `selectedRole` for BOOSTER rows (null for LOOTBUDDY). Absence of a row means not draft-selected. Composition, Final Setup, Attendance display, and Discord picked counts use `selectedRole` — never the volunteered `offeredRoles`.

Chosen over a JSON blob or a `rosterDraftSelected` column because:

- drafts survive reload
- later group assignment can hang off the same roster row
- publication metadata is relational
- signup status stays the live published roster

Opening `/runs/[runId]` as a manager may create an empty `RunRoster` (`ensure`). A USER view does **not** call `ensure`. That does **not** change `RunStatus`. The first **saved** non-empty draft selection on an `OPEN` run transitions `OPEN → ROSTERING` without closing signups (`signupsOpen` stays independent). Local card clicks alone never change Run status.

#### Roster entries

Draft rows point at `RunSignup`. The live roster after publish is still those signup rows:

| Signup status | Meaning |
| --- | --- |
| `PENDING` | Offer exists; no current published decision for this row |
| `SELECTED` | Part of the published roster |
| `NOT_SELECTED` | Considered and not on the published roster |
| `WITHDRAWN` | Player left before lock; never selected; never resurrected |

`isBackup` is still player intent, not a status. Backups may be draft-selected.

#### One user rule (Booster-specific)

**At most one selected BOOSTER participation per user per run.**

Selecting a second BOOSTER signup for the same user **replaces** the previous BOOSTER draft row. Silent double booster slots are forbidden. The service enforces this; the database cannot, because the path is `RunRosterEntry → RunSignup.userId`.

The same User **may** hold one selected BOOSTER **plus** any number of selected LOOTBUDDY rows. Lootbuddy selections are never collapsed by `userId`.

If one BOOSTER character is `SELECTED`, the user's other active BOOSTER offers on that run become `NOT_SELECTED` on publish. Lootbuddy rows are decided independently per `RunSignup.id`.

#### Roster lifecycle and lock point

- **Publish Roster** communicates the currently planned lineup. It does **not** freeze it.
- **`PUBLISHED`** stays editable until Start (UI: "Published · Editable until Start"): select or drop signups, change assigned roles, **Add Booster**, edit External Boosters, and **Edit Run** — the Run stays `PUBLISHED`.
- A published roster has **unpublished changes** (`roster-publish-state.ts` `hasUnpublishedRosterChanges`) when the saved draft differs from the live published roster (membership or assigned role) **or** a roster-relevant Run setting changed since it was last acknowledged (`RunRoster.runChangedSinceAck`, see [Signup history does not freeze the Run](#signup-history-does-not-freeze-the-run)). The primary action is then **Update Roster**. A freshly published roster, or a seeded draft identical to it, is clean.
- **Start Run** (`PUBLISHED → IN_PROGRESS`) is the authoritative freeze. Start is refused while there are unpublished changes ("Roster has unpublished changes. Update the roster before starting the Run.") so a replacement or a changed Run setting is never silently left unacknowledged. From `IN_PROGRESS` on the roster editor is read-only and every roster mutation (draft, roles, Add Booster, External Boosters, publish, repost) is rejected server-side.
- **Attendance Replace** (Attendance tab, `IN_PROGRESS` only) is the separate post-start operational substitution — it records a no-show and a replacement, it is not roster editing. See [Run lifecycle and attendance](#run-lifecycle-and-attendance).

**Concurrency.** Every roster-writing transaction locks the `RunRoster` row first, re-reads its version and re-checks inside the transaction that the Run has not started. Start takes the same lock before it reads the published roster, so a concurrent Save / Update Roster / Publish Roster / Add Booster / Run edit either commits first (and is included, or makes Start refuse with unpublished changes) or waits and then fails because the Run is `IN_PROGRESS`.

#### Roster tab layout

Managers see, top to bottom: the Run header (title, difficulty, status, product / content, schedule, Raid Lead, signups, targets — shown once); one compact bar with the Run notes and the Run administration actions (Edit Run, Open / Close / Reopen Signups, Cancel, Reactivate, Start, Complete); then the **Roster** — its header carries the slot count, Unsaved / Unpublished, the Validation and Preflight chips and every roster action (**Add Booster**, **Auto Build Roster**, **Boss plan**, Save / Update / Publish / Discard / Edit Published); directly below, the attention block (still needed, Late Fill, Find replacement, sync), the group grid, the composition line and the Boss plan panel. **Signups** (search, filters, tiles) follow under the roster, and the **Class Buffs** strip is the last section. Viewers keep the Run notes, signups and the published roster.

#### Add Booster (registered players)

**Add Booster** adds a **registered** player who did not sign up — typically a last-minute replacement. It is the **Registered player** side of the Roster's single **Add Booster** entry (Roster header, next to Auto Build / Boss plan / Publish; the dialog switches between **Registered player** and **External**), to managers only, while the roster is editable (`OPEN` / `ROSTERING` / `PUBLISHED`). Flow: search a player (server-side, `ACTIVE` accounts, name or Discord username, max 10 results, only id / name / Discord username exposed) → choose one of their Characters → role → **Add to Roster**.

- The player is rostered as a normal **BOOSTER `RunSignup`** — never a `RunExternalBooster` — so My Runs, commitments, reservations, notifications, Discord, Final Setup, attendance and out treat them like any pick.
- Same safeguards as a self-signup plus roster selection, no Raid Lead bypass, always against the **current** Run (difficulty, schedule, content): Character owned and active, the owner's Booster role (any Run difficulty), a role the class can play, weekly availability, cross-Run reservation / schedule conflicts, one selected Booster per User (adding a second Character replaces the first slot), roster version. Only the signup window is not required. Lockouts never block, but a saved Character needs the Raid Lead's confirmation (see [Selection risk](#selection-risk-clean--warning--blocked)).
- An existing active offer for that Character is reused (the assigned role is added to its offered roles if missing); otherwise a normal `PENDING` offer is created. A `WITHDRAWN` offer is never revived — the player has to sign up again.
- Atomic: the signup (reuse / role extension / creation) and the draft slot are written in one transaction with the Save Roster race checks and notifications (`rosterRepository.addManagedBoosterAtomic`). On any failure (version race, reservation race, withdrawal) nothing is left behind.
- Works directly on a legacy published roster whose draft was never seeded (`needsPublishSeed`): the same transaction first seeds the draft from the live published lineup (A, B, C keep their published roles) and then adds the new player (D). No separate "Edit Published Roster" step is needed and no published member is dropped.
- On a published roster the addition is a saved draft change, so the roster shows unpublished changes; **Update Roster** accepts it and edits the current Discord roster post.
- Disabled while the builder has unsaved local edits (button hint: "Save or discard your roster changes first") — it is a server mutation and must not overwrite an unsaved draft.
- Logged as Activity `ROSTER_PLAYER_ADDED`.
- Scope: registered **Boosters** only. Players without an account are added via the dialog's **External** side (below); Lootbuddies are added via their own signup or as External lootbuddies.

#### External boosters

Boosters who are **not registered** on the website (e.g. in-house helpers) are managed by hand on the **External** side of the Roster's **Add Booster** dialog (also opened by clicking an external slot in the roster grid; managers only, while the roster is editable: `OPEN` / `ROSTERING` / `PUBLISHED`). Existing entries can be **edited**, **removed**, or **added** before Start. Editable fields: **name**, **class**, **type** (Booster / Lootbuddy), and **role** (Booster only). Edits are staged in the dialog and persist only when the dialog-level **Save** runs — inline Edit → Apply / Cancel does not hit the server. A Booster entry needs a role the class can play; a Lootbuddy has a class only (no role). Stored in `RunExternalBooster` (per `RunRoster`, `participationType` + nullable `role`).

- The dialog saves the full set on its own (`rosterService.saveExternalBoosters`, optimistic on the roster version) and bumps the roster version once; the page reloads, so unsaved Roster builder edits are lost. Save Roster from the builder leaves them untouched (`saveDraftSelection` without `externalBoosters`); seeding a replacement draft never touches them. After Start, use **Replace** on the Attendance tab instead. The current replace path deletes and re-creates the full set, so persisted `RunExternalBooster` ids are regenerated on each Save.
- External boosters count toward the Tank/Healer/DPS composition, external lootbuddies toward the lootbuddy count; both count in the Class Buff Checker and never create validation blockers. External lootbuddies are listed with the lootbuddies everywhere (roster views, Discord roster, Final Setup as `@name`). Replace after Start fills a lootbuddy slot with an external lootbuddy.
- **Live roster data, not draft data:** there is no separate published snapshot. Saving them while `PUBLISHED` changes the published roster (`getPublishedRosterView`) immediately, bumps the roster version (so the Discord roster post is edited) and is **not** an "unpublished change" — Start and the Final Setup use the current rows.
- Shown as `@name <class emoji>` (plain text, never a ping) on the Discord **Roster** embed (in the one DPS group, melee before ranged), the Start Run preview and the Final Setup post — never fabricated onto the Signup embed.
- Not signups: no notifications/DMs, no attendance, strikes, lockouts or Raid Invites.
- Names allow letters, digits, space, `.`, `_`, `-` (max 32); `everyone`/`here` and markdown/mention syntax are rejected. Max 40 per roster.

#### Composition

Targets come from the run (`desiredTankCount`, `desiredHealerCount`, `desiredDpsCount`), never hardcoded 2/4/14.

- Booster slots count by `RunRosterEntry.selectedRole` (`TANK` / `HEALER` / `MELEE_DPS` / `RANGED_DPS`). Generic `DPS` is legacy-only (readable, never newly assigned).
- Raid Leads work with **Tank · Healer · DPS**: the Signups role filter, the composition line, the Publish summary, the Schedule staffing overlay and Find replacement show one DPS group (Melee and Ranged both fill it). Concrete `MELEE_DPS` / `RANGED_DPS` stay the stored roles (WCL, buffs, specs, audit); only historic generic DPS is still called out ("Unassigned DPS")
- Find replacement for a DPS slot ranks Melee and Ranged candidates alike; each keeps its own concrete DPS role (`rankReplacementCandidates`)
- Boss plan role options read plain "DPS" when it is the Character's only DPS option; a Character offering both keeps "Melee DPS" / "Ranged DPS" (a real spec choice, never guessed)
- Composition target remains a single desired DPS count
- A multi-role Character selected once contributes to exactly one concrete slot
- Lootbuddies (`LOOT_ONLY` and `PLAYING`) do **not** count as booster composition
- `PLAYING` has no assigned booster role, so it stays in the lootbuddy bucket

Mismatch is a **warning**, not an automatic hard block. A lead may draft 5/4 healers. Publish requires explicit acknowledgement when warnings exist. Blocking issues cannot be acknowledged away.

#### Class Buff Checker

Derived composition helper on the Roster Builder (informational — never a publish blocker).

- **Source of truth:** current **draft** selection (`RunRosterEntry.selected === true`), not every signup.
- **Booster:** counts by `character.wowClass` when selected.
- **Lootbuddy (LOOT_ONLY and PLAYING):** counts by `lootbuddyClass ?? character?.wowClass` when selected (includes legacy Character-backed rows) — a loot-only Lootbuddy is still in the raid group and brings its class buff. (Discord signups always create `LOOT_ONLY` rows.)
- **External booster:** counts by its class.
- **Duplicates:** multiple Mages still cover Arcane Intellect once; provider detail retains every `signupId`.
- **Meaning:** class *availability* in the selected composition — not live aura cast / talent verification.
- **No persistence:** coverage is computed by `evaluateRaidBuffCoverage` in `roster-raid-buffs.ts`. No coverage tables or stored counts.

Tracked set (Midnight Season 2): Arcane Intellect, Power Word: Fortitude, Battle Shout, Mark of the Wild, Skyfury, Devotion Aura, Blessing of the Bronze, Chaos Brand, Mystic Touch, Hunter's Mark, plus Warlock utilities Healthstone / Soulstone / Demonic Gateway, plus Death Knight utilities Raise Ally / Death Grip. The roster UI lists **provider classes** (Mage, Priest, Hunter, Warlock, Death Knight, …), not buff spell names — one Warlock or Death Knight covers all of that class's tracked utilities as a single tile. Rogue remains untracked (no composition buff/utility in this set).

#### Roster: Validation

`RosterService` + `validateRosterDraft` re-query authoritative rows. Client-supplied statuses and user IDs are ignored.

Blockers include:

- run not in `OPEN` / `ROSTERING` / `PUBLISHED` (including frozen `IN_PROGRESS` / `COMPLETED`)
- withdrawn selection
- inactive Character (BOOSTER and legacy Character-backed LOOTBUDDY only — characterless Lootbuddy is not inactive)
- owner no longer has the Booster role (`User.isBooster` — account-level, independent of Run difficulty; revoke is a publish blocker)
- two selected **BOOSTER** signups for one user

Raid lockouts are never a blocker — not for selection and not for publish. A known save on a fresh-loot Run is a selection **warning** that needs an explicit confirmation (see [Selection risk](#selection-risk-clean--warning--blocked)). Matching uses each Character's regional WoW reset containing `Run.scheduledStartAt` (not the Run date's ISO week alone). Verified `0/x` is Unsaved; no row is Unknown. `UNSAVED` and `VIP` share fresh-lockout attention presentation.
Warnings: composition under or over target.

Signup-time eligibility can rot before publish. Access and lockouts are therefore re-checked at publish.

#### Selection risk (CLEAN / WARNING / BLOCKED)

One shared, pure classifier — `services/roster-selection-risk.ts` — answers "may this Character be **newly** selected into this Run?" for the manual roster, Add Booster, Auto Build and Update Roster. It queries nothing; it composes two existing authorities:

- `scheduleConflicts` (`character-schedule-conflict`) — cross-Run Character reservation and weekly unavailability.
- `contentSaves` (`run-content-lockouts`) — one lockout label per `RunRaidContent`, whose `label.attention` already carries the Run's loot-type semantics.

| Level | When | Behaviour |
| --- | --- | --- |
| **CLEAN** | no schedule conflict, no known save that needs attention | select normally |
| **WARNING** | `saved` / `fully_saved` on a content the label authority marks as attention (i.e. `UNSAVED`, `VIP`, `COMMUNITY` Runs) | explicit confirmation required |
| **BLOCKED** | any schedule conflict | cannot be selected — **no override** |

- **Unknown** lockout state (no verified row) is CLEAN for selection: it means "not synced", and prompting on it would be noise. The card may still render it yellow.
- A `SAVED` Run expects lockout progress, so it never warns.
- BLOCKED always wins over WARNING. A same-Character overlapping-Run reservation can never be confirmed away.
- **Multi-content Runs:** a warning lists every affected content separately (`The Tidebound Grotto · 1/1 fully saved`, `The Venomous Abyss · 6/8 saved`) — never a summed `7/9`.

**Confirmation is validated by the server.** The client sends request-scoped acknowledgements — `confirmedWarnings: [{ signupId, type: "LOCKOUT_ATTENTION", fingerprint }]` (Add Booster omits `signupId`). The fingerprint encodes the affected contents and their progress (raid, difficulty, reset, kind, `x/y`). Before accepting a **new** pick the service recomputes the current risk:

1. hard schedule conflict → rejected, whatever was acknowledged;
2. current warning without an acknowledgement of the same type **and** fingerprint → `ROSTER_WARNING_CONFIRMATION_REQUIRED`, carrying the current warnings (`pendingWarnings` on the action result) so the UI re-prompts with the real state — e.g. confirmed at 6/8, now 7/8;
3. acknowledgements that match no current warning are ignored;
4. then the repository write runs, with its unchanged advisory lock + in-transaction reservation re-read as the final authority.

Nothing about a confirmation is persisted. Only **new** picks are checked: a slot already in the saved draft or already published `SELECTED` never re-prompts (reopening the editor, re-saving, publishing a saved draft, and deselecting need no confirmation). Deselecting and picking the Character again is a new pick.

| Path | Confirmation |
| --- | --- |
| Roster card checkbox → **Save Roster** (`saveDraftSelection`) | "Pick saved Character?" dialog per new pick; acknowledgements sent with Save |
| **Update Roster** (`updateRoster`) | same, for picks new to the roster |
| **Add Booster** (`addRegisteredParticipant`) | warning shown on the Character, confirmation on Add; schedule-conflicted Characters are listed as not eligible |
| **Auto Build / Fill gaps** (`proposeRoster`, `applyRosterProposal`) | warning (known save on a **planned** boss — per boss on Normal / Heroic, the whole content on Mythic, any full clear, or progress whose boss list is unknown or inconsistent with the verified count; `isSaveRelevantToPlannedBosses`) and blocked candidates are never proposed — left out before ranking, listed as `lockoutExcluded` ("Not auto-picked — saved for this Run"); the slot stays open instead of a saved fallback. Existing picks (Fill gaps) are kept and still flagged. Manual selection is unchanged |
| **Publish Roster** of a saved draft | none — nothing new is selected |

**Planned bosses only:** the selection warning (and so Auto Build's exclusion) only counts a save that hits the Run's planned bosses (`isSaveRelevantToPlannedBosses`, the first `plannedBossCount` in boss order): on Normal / Heroic a Character saved only on bosses outside a partial Run (6/8 Run, boss 8 killed) needs no confirmation and stays eligible; on Mythic any kill in the content counts (instance binding); a full clear, or progress whose boss list is unknown (older sync) or inconsistent with `bossesDefeated` (ids dropped by a catalog merge, unknown or duplicate ids, or a 0 count with stored kills), always counts. The boss list proves a save harmless only when its distinct ids are exactly `bossesDefeated` recognised bosses of the content. The informational lockout label and slot icon still show the verified progress (`HC 1/8 · Saved`) — information, not a warning to act on.

**Post-start replacement:** `attendanceRepository.replaceParticipantAtomic` (Attendance → Replace) is not a roster-draft write, but it makes a signup `SELECTED`, so it runs the same locked reservation re-read: a Character that is draft-selected or `SELECTED` on an overlapping Run cannot step in. Lockout warnings are not evaluated there.

#### Raid Lead QoL: replacement, gaps, Late Fill, attention actions

All of these work on the **CURRENT** Run only — its signups, availability, lockouts and the current draft. Nothing copies a previous roster. Every one of them changes the Roster Builder's **local draft** only; the Raid Lead reviews it and then uses the normal **Save** / **Update Roster** (roster version, server validation and warning confirmation unchanged). Nothing auto-publishes.

**Find replacement** (`components/manage/roster-replacement-dialog.tsx`, ranking in `lib/roster-replacement.ts`). Offered on a draft-selected Booster slot whose existing warnings make a replacement the natural fix — saved on this Run's content (selection-risk warning), schedule conflict, inactive Character, Booster role revoked (`rosterReplacementReasons`) — via the slot's ⇄ button or the Needs-attention strip, and for a picked player who withdrew (`withdrawnPicks`, shown while a bucket they could fill is still short). It carries the Run, the slot's role and Character and the Run's contents / bosses / raid ID / difficulty / time implicitly: the candidates come from the already-loaded roster view model. Candidates are current signups only (Add Booster stays the path for someone who did not sign up); never the slot itself, draft picks, Lootbuddies, withdrawn / inactive / revoked rows, or a User who already holds another draft Booster slot (the target's own other Character stays eligible — a swap). The best **5** are shown first; "Show all N candidates" lists the rest (nothing is dropped; switching the role returns to the shortlist). Order: plays the required role → no schedule conflict → not saved (shared selection risk) → not planned on another Run → fresh Blizzard sync (`syncHealth`) → primary role, then preferred offspec → cached WCL Best Perf. Avg → item level → name / id. WCL only orders, never excludes, and is never fetched for the picker. **Same role only** is on by default; **Show conflicted** lists schedule-conflicted signups last and disabled. Choosing a candidate stages it in place of the slot through the same path as a tile click (saved → "Pick saved Character?").

**Update Roster diff** (`lib/roster-diff.ts`, `roster-update-diff.tsx`). The Update dialog lists exactly what the draft changes against the published roster: `+` added, `−` removed, `⇄` Character changed (same User's removed + added Booster), `~` role changed — identity by signup / User, never row order. Lootbuddies appear as added / removed. External Boosters are live roster data, not draft data, so they never appear. First publish is unchanged.

**Auto Build Roster in the editor** opens on top of the current (possibly unsaved) draft (`rosterBuilderService.proposeRoster(…, { baseSelections })`, read-only; same candidate rules and selection risk; saved candidates are never auto-picked):

- **Fill gaps** keeps every draft pick locked — Boosters and Lootbuddies, including a `NOT_SELECTED` signup re-selected on a published roster, with its role and chosen spec — and fills only the missing composition. Only `WITHDRAWN` (or unknown) ids drop out of the base. No extra confirmation.
- **Build from signups** proposes a whole draft from the current signups and **replaces all draft Boosters and Lootbuddies**; External Boosters stay (they are not draft data). When the draft holds at least one Booster or Lootbuddy, Apply first asks "Replace the current draft?" — Cancel (or Escape) leaves the draft exactly as it was; an empty draft applies without asking.

**Proposal objective** (`optimizeRosterProposal`): first fill as many open Tank / Healer / DPS slots as the eligible signups allow — an exact maximum (bipartite matching Users → slots, one Booster slot per User across Characters); a pick is only taken when the maximum stays reachable, so a hybrid never takes a slot a single-role player needs while another slot would stay empty (single-role players are not forced first either). Only among equally complete rosters do raid utility, primary / offspec role, WCL and item level decide. Locked picks (Fill gaps) and their Users are never replaced or reused; Lootbuddies fill their own bucket; DPS stays one aggregate count (Melee / Ranged per pick by role preference, then WCL).

**Apply to draft** stages the result. Opened from the Run header or the Schedule, Auto Build keeps its old behaviour (proposal from the saved / published roster, Apply saves the draft).

**Late Fill** is presentation, not a Run state: within 24 h of the start (`isLateFillWindow`, `run.lateFill`) the strip reads "Late fill · Need N replacements". Each short role (Tank ×1, Healer ×2, DPS ×3) opens the candidate picker for that slot, and **Ping roles** (below) asks Discord for the rest; Fill gaps is in the Auto Build Roster dialog.

**Ping roles (Discord).** One button in the Roster toolbar, whenever the roster is editable (also when fully staffed), opens a compact dialog (`roster-ping-roles-dialog.tsx`) with **Automatic** and **Custom request**. Opening it and previewing write nothing and start no cooldown (`getPingRolesDialogDataAction`); **Send ping** queues exactly one message for the bot. It opens on Custom when Automatic has nothing to send.

**Delivery status:** a successful Send only says **Ping queued**: the bot posts on its next pass and reports back. No page polls for that; the dialog shows the bot's outcome of the Run's newest ping when it opens (`lastPingStatus`, `PING_DELIVERY_LABELS`): queued, delivered (only `SENT`), or not sent / not delivered (`SKIPPED`, `FAILED_PERMANENT`). A ping that was not delivered still counts for the cooldown.

**Custom request** (`requestCustomPingAction` → `lateFillHelpService.requestCustom`) sends the Raid Lead's own one-line text (max 200 characters, in bold) with the Guild roles they pick behind it: `**Need 1 LB for Coiled Altar** @Lootbuddy`. Text and roles are independent and it needs no open slot: "LB" never implies a Booster ping. The choice is an allowlist (`PING_ROLE_KEYS`): Tank, Healer, DPS, Lootbuddy and the class roles; everything else in the Guild is never offered. A role is offered only when it exists uniquely and is not bot-managed (`resolvePingRoleIds`: a configured `DISCORD_PING_ROLE_*` id wins for Tank / Healer / DPS and never falls back; otherwise the exact name, for Lootbuddy `Lootbuddy`, `Lootbuddies` or `LB`). The web reads the roles from Discord when the dialog opens and again on send; if it cannot, nothing is sent. Text with `@everyone` / `@here`, mention syntax, line breaks or invisible characters is refused; other markdown is escaped so it cannot leave the bold. Same gate, row lock, lane and Run channel as Automatic, stored in the same `helpRoles` column (no migration); the bot re-validates the stored row, re-resolves the roles and restricts `allowedMentions` to exactly those ids. A role that vanished in between is left out; none left → SKIPPED.

**Shared cooldown:** every role and class at most once per 30 min per Run across Automatic and Custom. Automatic drops what is cooling down; Custom never trims the Raid Lead's choice, it is refused and names the roles. Help messages carry a Discord delivery nonce, and a message already posted is not posted again when only its SENT report failed.

**Automatic** (`requestLateFillHelpAction` → `lateFillHelpService.request`) posts ONE message in the Run channel pinging the Guild role (`DISCORD_PING_ROLE_TANK_ID` / `_HEALER_ID` / `_DPS_ID`) of each role the **saved** roster still misses (authoritative staffing; Lootbuddies have no ping role). Who: whoever may manage the Run. When: any time before Start (no 24 h window), Run OPEN / ROSTERING / PUBLISHED, not archived, with a Run channel. Anti-spam: each role at most once per 30 min per Run (`LATE_FILL_HELP_COOLDOWN_MS`), enforced under the roster row lock so concurrent clicks send one message. Stored as a `RunDiscordAnnouncement` of type `LATE_FILL_HELP` (`helpRoles` snapshot); the bot posts it through the Run-announcement lane with `allowedMentions` restricted to exactly those role ids, after re-checking the Run can still take players (never once started, completed, cancelled or archived), and marks it SKIPPED when the bot has none of those ping roles. Message format: `**1 more Healer and 3 more DPS needed here** @Healer @DPS` (need in bold, roles at the end). If the saved roster misses class buffs (`missingBuffProviderClasses`: the Roster tab's own coverage; none at all while any rostered class is unknown), a second line in the same message names them: `**Missing class buffs: Mage, Warlock** @Mage @Warlock`. The bot resolves class roles by their exact unique Guild role name (no configuration, same convention as the class emojis); a class with no unique role is named without a ping and logged, never replaced by another role. Classes share the cooldown. On a fully staffed roster the class line goes out alone, pinging only what is really missing; with no missing role and no missing class buff no message is sent. While a missing role has no ping role at all the request stays refused. Feedback names the queued roles, missing class buffs, roles still cooling down and roles without a configured ping role. Never changes the roster, signups or the Run.

**Needs attention → action.** The strip above the roster groups shows existing warnings with their action: short composition → role pickers / Ping missing roles; saved / conflicted / inactive / revoked slot → Find replacement; withdrawn pick → Find replacement; selected Characters without a fresh Blizzard sync → **Sync Characters** (`rosterCharacterSyncService.syncStaleSelected`: server-chosen saved-draft / published picks whose sync health is not HEALTHY, through the one sync entry point, manual-refresh cooldown respected, at most 40, 3 at a time). Preflight checks link to the same place (`preflightCheckAction`: Find replacements / Fill gaps / Sync Characters / Review & Update). No new warning state.

**Query shape.** The picker, the diff and the strip read only the roster view model the page already loads (one batched schedule-conflict read, one batched commitments read, cached WCL for all signups — no per-candidate query, no WCL or Blizzard request per render). `syncHealth` is derived in memory from the Character snapshot. Fill gaps / Build is one `proposeRoster` call: the same batched reads as Auto Build (signups, account statuses, schedule conflicts, cached WCL).

#### Boss-specific exceptions

Behind the switch `ROSTER_BOSS_EXCEPTIONS_ENABLED` (off by default; while off, boss exception input is refused — see **Switching off**).

The roster stays the default: every selected Booster plays **every planned boss** with their slot's Character and role. Only deviations are stored, in `RunRosterBossException` — never a roster per boss. A Run without exceptions behaves exactly as before (no new warning, no new state).

- **Identity.** One row = one roster slot (`slotSignupId`) × one planned boss (`runRaidContentId` + `raidBossId`, so Bundle bosses stay distinct) × `stage` (`DRAFT` / `PUBLISHED`). Unique per roster, stage, slot, content and boss — a player holds at most one Booster slot per boss.
- **What may change for a boss.** The role (concrete: Tank / Healer / Melee / Ranged) and/or the Character: `playSignupId` is another BOOSTER signup of the **same player on the same Run** (null = the slot's own Character). Rows that only restate the default are dropped.
- **Hard rules** (Save / Update / Publish refuse): selected Booster slot; a **planned** boss of that content (6/8 → bosses 1–6 only); alternate Character of the same player, not withdrawn, active, owner still a Booster, no schedule conflict / reservation, not itself a roster slot; role offered by the playing signup.
- **Warnings** (acknowledged with the composition warnings on Publish / Update, never a Save block): per-boss composition only for bosses an exception touches, grouped — "Boss 7–8: 2 of 3 Healers" / "Venom 5–6: …" in Bundles; boss-exact lockouts of an alternate assignment on fresh-loot Runs — "Boss 8: Alt-Realm is already saved" (from `killedBossIds`; a full clear counts for every boss).
- **Draft vs published.** Save writes the DRAFT set (a slot that leaves the draft loses its rows); Publish / Update copies DRAFT → PUBLISHED in the same transaction; Edit Published seeds DRAFT from PUBLISHED. Unpublished changes (Update needed, Start refused) include a differing exception set. The Update diff shows a kept slot's plan change as one `~` line.
- **Reservation.** An alternate Character is reserved by the Run like a selected one (cross-Run conflict checks and commitments), and re-checked inside the write transaction.
- **Run edits.** When contents are replaced (raid or planned boss count changed), exceptions on bosses that stay planned move to the new content row; those of a removed raid or an unplanned boss are dropped. The existing "Run changed since publish" flag then requires Update Roster. A replacement that moved or dropped exception rows also bumps the roster version, so an open Roster Builder gets "Refresh roster" instead of sending exceptions for content ids that no longer exist.
- **Alternate signup status.** Publish / Update does not mark an alternate Character's signup NOT_SELECTED — it plays bosses of this Run (a former published slot still leaves SELECTED).
- **Withdrawal.** A withdrawn slot takes all its exceptions with it. A withdrawn alternate Character drops only its DRAFT rows: the PUBLISHED plan stays until Update, so the roster shows "Update needed" instead of changing the published plan silently. Every affected roster is locked and its version bumped, also when the alternate holds no roster entry.
- **Roster Builder UI (Boss plan).** With the switch on, the Roster header shows **Boss plan**, which opens an inline panel under the roster grid (no dialog, no separate page). Bosses appear as numbered chips in Run order (Bundles: one group per content, labelled with its short name). Click a boss to select it; click another to select the contiguous range between them (a third click starts over). For the range, every slot that can deviate lists its Character (own Character preselected, then the player's other eligible signed-up Characters — never one that holds its own slot) and role (the slot's role preselected); a range that partly deviates shows "Mixed". Changes only stage the DRAFT set; **Save / Update / Discard** are the roster's usual actions and send the full set (`bossExceptions`). Each slot with exceptions shows one compact line ("Boss 5–6: Alt-Realm · Healer"); without exceptions the roster looks as before. Chips mark bosses with exceptions and with warnings; per-boss warnings (composition, boss-exact lockouts) are computed live with the server's rules, join the Publish / Update acknowledgement and never block Save; hard issues block Update / Publish like any roster blocker. `ROSTER_ALREADY_CHANGED` and `SIGNUP_WITHDRAWN` (also a withdrawn alternate) offer **Refresh roster**; rows the refreshed roster no longer supports (alternate withdrawn or now a slot, boss no longer planned) are dropped from the payload.
- **Discord.** The Roster message gets one "📋 Boss plan" field — one line per deviating slot, same stage as the lineup (draft plan before Publish, published after): `<@player> — Venom 5–6: Alt-Realm · Healer; Tide 1: Ranged DPS` (consecutive identical assignments collapse into ranges, Bundles name each content). Final Setup (start post and the web Start preview) adds the same lines as a "📋 **Boss plan**" section after the lineup. Only live slots are shown, only alternates still signed up. A roster without exceptions renders byte-identical to before; the Roster render fingerprint carries a short key of the shown plan, so a plan change refreshes exactly those messages.
- **DMs.** Publish / Update compares each accepted slot's old and new PUBLISHED plan: a player who stays in the roster and whose plan changed gets one "📋 Boss Plan Update" (a ROSTER_SELECTED with source key `roster-boss-plan:<run>:<version>:<slot>`, same preferences and Quiet Hours as Roster Selected; no migration) naming the new plan, or "every boss as rostered". Unchanged players hear nothing; a player newly selected in the same write gets the normal Roster Selected only, which shows their boss plan line. Roster DMs show only the **published** plan, rendered at delivery: a draft plan is never DMed (a Save-time Roster Selected followed by Publish never repeats it), a still-undelivered Roster Selected / Roster Update absorbs a later plan change (no extra notice), and a still-undelivered older Boss Plan Update is superseded (its DM skipped) by the new one — one DM per change.
- **Start.** Preflight lists Boss plan issues (alternate withdrawn, inactive, without Booster role, schedule-conflicted / reserved elsewhere, holding its own slot; role not offered) and per-boss warnings under the label "Boss plan" — advisory like every post-Publish conflict, the Raid Lead decides; unpublished plan changes still refuse Start. The post-Start saved check syncs and checks every Character that plays, each for exactly its bosses (an alternate for its exception bosses, the slot Character for the rest).
- **Consumables audit.** Each fight is audited for the Character assigned to its boss: an alternate's fights (matched by Run content + WCL encounter id) form **their own audit row** for that Character (same attendance and player, the alternate's name, class and planned role), so class-bound checks (weapon enhancement, enchants, played spec) are judged for the Character that actually played; the slot Character's row keeps the rest (no row when it played none). Never both on one pull. Role-only exceptions change nothing (the played role comes from the log).
- **Replacement after Start.** The replaced slot drops its boss exceptions (both stages) in the replacement transaction; a replacement that was an alternate stops being one. Discord, Final Setup and the audit therefore never show a stale published plan.
- **Switching off.** The switch gates **authoring** only: with it off the API refuses boss exception input and the Boss plan editor is hidden, so no plan is created or changed. Plans already stored are never silently ignored — they keep applying everywhere (roster view incl. the slot plan lines, boss warnings and blockers, unpublished-change detection, Publish / Update validation and copy, Boss Plan Update DMs, alternate reservations, Discord, Final Setup, Start checks, consumables audit), because players were told them and the audit / saved checks must judge what was actually played. Ignoring them would audit the wrong Character, free a reserved alternate and skip its lockout check. A stored plan leaves only through the roster (its slot or alternate leaves, a replacement after Start) or, with the switch on again, the editor. Runs without exceptions are unaffected either way.
- **Not affected.** Attendance stays one row per roster slot; Smart Replacement works on the default roster (a replaced slot's exceptions leave with it). Auto Build and Fill gaps keep existing picks (Character and role) and their exceptions untouched and never propose a player who already holds a slot — so never their alternate. There is no payout domain.

#### Run commitments (informational)

Roster Builder attaches `runCommitments: CharacterRunCommitment[]` to each BOOSTER card via a **batched** repository lookup (`listReservingCommitmentsByCharacterIds`, one read for all Characters), excluding the target Run.

**Scope: the target Run's raid ID.** A commitment is shown only when the other Run lies in the same regional weekly reset as the target Run *for that Character's region*: `lockoutService.getResetIdentifierForRun(character.region, other.scheduledStartAt) === …(character.region, target.scheduledStartAt)` (EU resets Wednesday 04:00 UTC, US Tuesday 15:00 UTC — fixed UTC instants, so daylight-saving changes do not matter). Never by calendar week, date distance or the Discord CURRENT/NEXT bucket. A reservation in the current raid ID is therefore not shown on a next-ID Run's roster, and vice versa.

| State | Meaning |
| --- | --- |
| `RESERVED` | Draft-selected on another upcoming Run; not yet published `SELECTED` |
| `COMMITTED` | Published `SELECTED` on another upcoming Run (`PUBLISHED` / `IN_PROGRESS`, etc.) |

UI: compact **Other run · Draft roster** (danger/red, informational) and **Other run · Published roster** (warning/orange, informational) indicators — they do **not** themselves block selection. Separately, real `scheduleConflicts` use a strong danger/red alert treatment and still gate new selection / publish. They are **independent of the raid ID**: two Runs < 2 h apart conflict even when a weekly reset lies between them.

| UI label | Domain state | Tone | Blocks selection? |
| --- | --- | --- | --- |
| Draft roster | `RESERVED` | danger / red | No |
| Published roster | `COMMITTED` | warning / orange | No |
| Schedule conflict | existing blocker | strong danger alert | Yes |

Commitments are derived only — no persisted `safe` / `committed` flags. They disappear when the other Run completes/cancels, the draft deselects (for `RESERVED`), or a republish removes the published slot (for `COMMITTED`).

#### Publication

The Roster tab shows exactly one primary path per state (`resolveRosterActions`, `src/components/manage/roster-actions.ts`):

| State | Actions | Discord |
| --- | --- | --- |
| Never published, local edits | **Save Roster** (+ Discard) | edits the persistent Roster message when one exists (or creates the empty/draft Roster once Signup is provisioned) — Save alone never advances `postRevision` |
| Never published, saved | **Publish Roster** — first authoritative publication | syncs the same Roster message and acknowledges `postRevision 0 → 1` (creates it only if missing) |
| Published, local edits / saved changes / changed Run settings | **Update Roster** — ONE action: accepts the current selection as the published roster | edits the **current** roster message in place |
| Published, clean (`PUBLISHED` Run) | **Publish Roster** — explicit refresh | edits the **same** roster message in place and acknowledges a new `postRevision` |

- **Update Roster** (`rosterService.updateRoster` → `rosterRepository.updatePublishedAtomic`) validates the submitted selection against the current Run, then writes it as the draft and publishes it in one transaction (same row lock / version check / pre-start check as Publish) and clears `runChangedSinceAck`. A refused Update changes nothing. There is no separate Save step on a published roster.
- **Publish Roster on a published roster** never changes membership, roles, statuses or notifications; it only requests another Discord sync of the persistent Roster message. It is blocked while there are unpublished changes (Update first; `ROSTER_UNPUBLISHED_CHANGES`). The request is a compare-and-set on the expected roster `version` **and** the expected `RunRoster.postRevision` (`rosterRepository.requestRepostAtomic`): exactly one of two double-submitted requests advances `postRevision` to N + 1; the other fails with `ROSTER_ALREADY_CHANGED`. Logged as Activity `ROSTER_POSTED`.
- There is exactly one live Roster Discord message per provisioned Run (`rosterMessageId`). Publish / Update / Save always edit that message; missing or Discord-deleted messages are recreated once. Final Setup (`startMessageId`) stays a separate post after Start.

The first publication, and Update Roster, run in one database transaction:

1. Draft-selected signups → `SELECTED`
2. Other non-withdrawn candidates → `NOT_SELECTED`
3. `WITHDRAWN` stays `WITHDRAWN`
4. Run `OPEN` → `ROSTERING` → `PUBLISHED`, or `ROSTERING` → `PUBLISHED`
5. Roster `state = PUBLISHED`, `version++`, `publishedAt`, `publishedById`, `runChangedSinceAck = false`; the first publication also sets `postRevision = 1` (the first post intent)
6. Activity `ROSTER_PUBLISHED` (first time) or `ROSTER_UPDATED` (republish)
7. `ROSTER_SELECTED` / `ROSTER_REMOVED` user notifications only for changes the player has not been told yet (see [User settings and notifications](#user-settings-and-notifications)). **Save Roster** already notifies (see below), so publishing a saved roster usually sends nothing new; Discord DM intent is snapshotted from preferences when the notification is created

**Save Roster notifies.** Saving the draft (`saveDraftSelection`) sends `ROSTER_SELECTED` to each selected player who was not already told they are in, and `ROSTER_REMOVED` to each player who was told they are in but is no longer selected (never to `WITHDRAWN` offers). What a player was last told is their latest `ROSTER_SELECTED`/`ROSTER_REMOVED` notification for that signup (ordered by the roster version in its `sourceKey`); signups without one fall back to their `SELECTED` status. Seeding a replacement draft from the published roster never notifies. **Character swap:** when a player's booster character is exchanged for another of their booster signups, they get one **Roster Update** DM with the new assignment (a `ROSTER_SELECTED` with a `roster-swapped:` source key, web title "Roster updated"); the old character's `ROSTER_REMOVED` is kept only as hidden bookkeeping state (`visibleInApp = false`, already read, no DM) so later saves/publishes don't announce a removal — it is not shown in the bell or on the Notifications page, doesn't count as unread and never sends a removal DM (a player holds at most one booster slot). Dropping the player with no replacement booster character is a normal, visible removal. Lootbuddy entries are still per entry: a Lootbuddy change is never treated as a character swap.

A picked player withdraws only with a reason and only until Start (see picked-player withdrawal under Signups).

A published run may still receive **new** `PENDING` signups while `signupsOpen` is true — publishing the roster does **not** close registration. Late Booster / Lootbuddy / Quick Signup offers stay `PENDING` and do **not** change the live published lineup, attendance, or Discord roster until the Raid Lead explicitly selects them and runs **Update Roster**. Start Run is the lifecycle freeze that atomically closes signups.

#### Republish

**Edit Published Roster** copies current `SELECTED` signups into the draft when the draft is still empty (`version === 1` and no entries). It does **not** revert signup statuses. Add Booster performs the same seed itself.

The published roster stays live until an Update succeeds. The lead may add a newly arrived `PENDING` offer, **Add Booster** for someone who never signed up, drop someone, change roles, and **Update Roster**. The Run stays `PUBLISHED`; Update Roster edits the current Discord roster post in place and only notifies players about actual changes.

`IN_PROGRESS` and `COMPLETED` runs reject draft mutation, publish, and republish. See [Run lifecycle and attendance](#run-lifecycle-and-attendance).

#### Roster: Security

- Current user comes from the session, not the client body
- `requireManagerOrRedirect` gates `/manage` and `/manage/runs`
- Canonical Run detail is `/runs/[runId]`; manager payload is omitted unless `canManageRun`
- `assertCanManageRun` gates every roster read/mutation
- Zod validates run/signup IDs and version only — not statuses or ownership
- Publish re-reads DB state and checks `version`

#### Roster: MVCS

| Layer | Roster pieces |
| --- | --- |
| Model | `RunRoster`, `RunRosterEntry`, `RosterState` |
| View | `/manage/runs`, `/runs/[runId]` Roster tab, `roster-builder.tsx`. `/manage/runs/[runId]` redirects. |
| Controller | `managementController.getRosterPage`, `saveRosterDraftAction`, `prepareRosterEditAction`, `validateRosterAction`, `publishRosterAction` |
| Service | `RosterService`, `roster-composition`, `roster-validation`, plus `Run` / signup / access / lockout helpers |
| Repository | `RosterRepository` (Prisma stays here) |

#### Roster: Deferred

- Raid groups 1–8, parties, markers, assignments
- Customer bookings / boost market

### Run lifecycle and attendance

#### Lifecycle: Purpose

Operational Run completion after roster publication:

`PUBLISHED` → `IN_PROGRESS` → `COMPLETED`

Assigned raid leads and admins start a published Run, record who actually attended, and complete the Run only when every attendance row is marked.

This is not Warcraft Logs, Blizzard, Discord notifications, or analytics.

#### Lifecycle

Roster Management still owns `OPEN → ROSTERING` and publication to `PUBLISHED`.

This feature owns:

- `PUBLISHED → IN_PROGRESS` via **Start Run**
- `IN_PROGRESS → COMPLETED` via **Complete Run**

There is no generic `RunStatus` dropdown.

Cancellation before start remains Run Management policy (`DRAFT` / `OPEN` / `ROSTERING` / `PUBLISHED`) and is reversible via **Reactivate Run** when a pre-cancel snapshot exists. Ordinary cancellation from `IN_PROGRESS` is still not offered. Start and Complete remain irreversible operational freezes.

#### Start Preconditions

The server re-reads authoritative state. Start requires:

- the Run exists
- `Run.status === PUBLISHED`
- the caller can manage the Run (`canManageRun`)
- a published roster exists (`publishedAt`)
- at least one currently `SELECTED` participant
- **no unpublished roster changes** — the saved draft must match the published roster (membership and assigned roles) and no roster-relevant Run setting may have changed since the roster was last published / updated (`RunRoster.runChangedSinceAck`); otherwise Start fails with "Roster has unpublished changes. Update the roster before starting the Run." (`ROSTER_UNPUBLISHED_CHANGES`). The Start dialog also warns, but the server check is authoritative.

These checks run inside the Start transaction after it has locked the `RunRoster` row — the same lock every roster write takes first — so the snapshot always equals the published roster at the moment of Start; a concurrent roster write or Run edit either commits before Start (and is checked) or waits and is rejected once the Run is `IN_PROGRESS`. Start uses the Run's current metadata (difficulty, content, schedule, composition).

Scheduled start time is **not** a blocker. Runs may start early or late.

##### Preflight ("Ready to start?")

`runPreflightService` (`src/services/run-preflight.service.ts`) assembles an advisory checklist from the already-loaded roster management view. It is shown as the Preflight panel on Run Detail and inside the **Start Run** dialog, split into **Start will be refused** (ERROR — mirrors the hard rules above) and **Check before starting** (WARNING). Warnings never block Start; the server checks above stay authoritative.

**Saved re-check after Start** (`runStartSavedCheckService`, after the Start Run response via `after()`): every SELECTED Booster Character gets a fresh Blizzard sync (trigger `RUN_START`, 3 at a time; a failing sync falls back to the last known lockouts), then each owner whose Character is saved on a **planned** boss of this Run gets a `ROSTER_CHARACTER_SAVED` reminder ("Reminder: you are saved — Boss X, no loot from those bosses"), bell + Discord DM, once per pick and boss set. Because this fresh sync can find saves the checklist above did not show, the **Raid Lead** gets **one grouped summary** ("Selected Characters are saved" — one line per affected Character with its bosses, "Check the roster", links the Roster tab), bell + DM, only when at least one pick is affected and once per affected set. "Planned" = the first `plannedBossCount` bosses in authoritative order (6/8 = bosses 1–6; a kill on boss 7 never counts).

ERROR is used only for the server Start rules above (status, published roster, unpublished changes, ≥1 published selected participant). Warnings cover desired composition, a missing Raid Lead, an unseeded draft or draft publish invariants (they block the next Publish, not Start), Discord channel / signup message / integration health, and the selected registered Booster Characters:

- **Schedule conflicts** — reserved on another Run or weekly unavailable (can appear after Publish)
- **Lockouts** — known saved content needing attention (same `roster-selection-risk` classification as selection)
- **Blizzard sync** — no fresh successful sync (`deriveCharacterSyncHealth`: ERROR / NEVER_SYNCED / STALE), so lockouts and item level may be outdated

External Boosters carry no Character and are not part of these checks.

#### Roster Freeze

Once the Run is `IN_PROGRESS` (and after `COMPLETED`):

- draft selection is rejected
- publish / republish is rejected
- published-roster seed-for-edit, Add Booster and roster repost are rejected
- Run edits (Edit Run, Raid Lead reassignment) are rejected (`RUN_EDIT_LOCKED`)

Attendance is the roster that entered the Run. Later roster edits cannot silently rewrite attendance rows.

`PUBLISHED` roster editing before Start stays allowed (Start is the lock point — see [Roster lifecycle and lock point](#roster-lifecycle-and-lock-point)). Post-start substitutions go through **Replace** below, which records attendance; it does not reopen the roster editor.

#### Attendance Snapshot

Start is transactional. It either:

1. creates one `RunAttendance` row per currently `SELECTED` published participant
2. sets `signupsOpen = false`
3. sets `status = IN_PROGRESS`

or it writes nothing.

Initial status is `UNMARKED`. Nobody is auto-marked `PRESENT`.

Source of truth is live `SELECTED` `RunSignup` rows on a published roster, linked to `RunRosterEntry` (created if a seed/published snapshot is missing the matching entry). `PENDING` / `NOT_SELECTED` / `WITHDRAWN` rows are not snapshotted.

Booster and lootbuddy selected participants are included in the same attendance list.

Double start does not duplicate rows (`rosterEntryId` is unique; a second start is `RUN_ALREADY_STARTED`).

Start does not mutate BoosterAccess, signup history semantics, character ownership, or lockouts.

#### Attendance Status Semantics

| Status | Meaning |
| --- | --- |
| `UNMARKED` | Not yet decided. Blocks completion. |
| `PRESENT` | Attended normally. |
| `LATE` | Attended, joined late. |
| `LEFT_EARLY` | Attended, left before expected completion. |
| `NO_SHOW` | Expected, did not attend. |
| `EXCUSED` | Did not attend; absence accepted. |
| `STANDBY` | Rostered as backup/standby and not required to participate. |

A backup that was available but not needed must not be classified as `NO_SHOW`. Use `STANDBY`.

#### Replacing a participant after Start

While the Run is `IN_PROGRESS`, the manager can **Replace** any attendance row (typically a no-show) from the Attendance tab (`attendanceService.replaceParticipant` → `attendanceRepository.replaceParticipantAtomic`, one transaction):

- The original row becomes `NO_SHOW` with the note "Replaced by …"; the original signup leaves the live roster (`SELECTED` → `NOT_SELECTED`).
- **Signed-up replacement:** a `PENDING` / `NOT_SELECTED` signup of the same Run and participation type (a player already holding a booster slot is rejected). It becomes `SELECTED` in the original's role, gets its own attendance row marked `PRESENT` with the note "Replacement for …", and a `RAID_INVITE` notification.
- **External replacement** (booster slots only): added to the roster as an external booster in the original's role (see [Roster management](#roster-management)). It appears in the Final Setup but has no attendance.
- `RunRoster.version` is bumped: the Discord roster post and the **Final Setup** post are edited in place. The Final Setup omits `NO_SHOW` / `EXCUSED` rows. `RunDiscordPost.lastStartRosterVersion` records which roster version the posted Final Setup reflects; a Final Setup posted before this existed gets its baseline set by the first replacement.

This is the one exception to the roster freeze below: draft saves and republish stay rejected after Start.

#### Backup / Standby Semantics

Signup `isBackup` is player intent, not attendance.

Do **not** auto-assign `STANDBY` because `isBackup = true`. A backup may be used and attend.

The manager UI shows Backup clearly and offers an easy Standby action for those rows. Final status is a manager decision.

#### Lifecycle: Authorization

| Account | Start / Complete / mutate attendance | View |
| --- | --- | --- |
| `USER` | No | Own attendance row only, without manager notes |
| `RAID_LEAD` | Assigned Run only | Full operational list on assigned Runs |
| `ADMIN` | Any Run | Full operational list |

`canManageRun` remains the ownership check. Capabilities (`canStart`, `canManageAttendance`, `canComplete`) are server-derived.

#### Discord voice hint

While the Run is IN_PROGRESS each manager row shows *In voice* / *Not in voice* / *Voice unknown* from the bot's short-lived report of the Run's assigned voice channel (see [Run voice channels](#run-voice-channels)). It is information only: it never sets, suggests or bulk-applies an attendance status — manual attendance stays the only authority.

#### Bulk Mark Present

**Mark all unmarked as Present** is a single service/repository operation.

Only `UNMARKED` rows become `PRESENT`. Existing `LATE`, `LEFT_EARLY`, `NO_SHOW`, `EXCUSED`, and `STANDBY` rows are preserved.

Typical workflow: mark exceptions first, then bulk-present the rest.

#### Completion Invariant

A Run cannot complete while any attendance row is `UNMARKED`.

The check is transactional. The domain error is `ATTENDANCE_INCOMPLETE` and includes how many unmarked rows remain.

Completion records `Run.completedAt`. Together with `RunStartSnapshot.startedAt` it is the Run's active window, which the Consumables Audit uses to tell which Warcraft Logs fights belong to this Run (see [Run Consumables Audit](#run-consumables-audit)).

UI copy: “Mark attendance for all rostered participants before completing the run.”

React is not the enforcement boundary.

#### Completed Read-Only Policy

On success:

- `status = COMPLETED`
- `signupsOpen = false`
- attendance remains stored and becomes read-only in this feature

Signup, roster, BoosterAccess, and lockout history stay intact. Completion is final: BoostingHub has no financial follow-up. Exceptional mistakes are fixed with the audited **Correct Attendance** action (reason required; recorded in Run History).

#### Canonical Run Detail Integration

Attendance lives on `/runs/[runId]` as a tab next to Roster, Operations and History (completed Runs also show Consumables to managers).

There is no `/manage/runs/[runId]/attendance` implementation.

##### Before start (`PUBLISHED`)

- Manager: “Run has not started yet.” plus **Start Run** (confirmation dialog).
- USER: “Attendance will be available after the run starts.”

Viewing the tab does not create attendance rows.

##### In progress

Manager compact table: character, user, class/role, participation type, backup, status, note, actions.

USER: “Your Attendance” for their own row only.

##### Completed

Read-only. Manager sees the full list and a compact status summary. USER sees own final status.

#### Security / DTO Shaping

`runDetailService` shapes viewer payloads:

- USER: `attendance.manager = null`, `attendance.own` only, capabilities false, no `markedBy` / manager notes
- Manager: full attendance list, notes, lifecycle capabilities

Hiding a loaded manager list in React is not sufficient.

`markedById` is always the authenticated manager. Clients cannot submit `RunStatus`, `markedById`, or ownership.

#### Lifecycle: MVCS

```text
View → Controller → Service → Repository → Model
```

- `RunService.startRun` / `completeRun` own lifecycle transitions
- `AttendanceService` owns query, status updates, bulk present, completeness
- `attendance.repository` owns transactional snapshot and completion writes
- Controllers (`startRunAction`, `setAttendanceAction`, `markAllPresentAction`, `completeRunAction`) authenticate, validate with Zod, call services, map domain errors, revalidate `/runs/[runId]`

No Prisma in views or controllers. No attendance transition rules in React.

#### Lifecycle: Deferred

- Discord-side attendance marking (stays web-only; Discord DMs and lifecycle announcements exist)
- Broader performance / reputation products beyond consumables audit and roster WCL rankings

### Run Consumables Audit

#### Consumables: Purpose

A factual post-run overview, from the Run's Warcraft Logs report, of whether each booster had a flask, used a combat potion, and — for every death — used a Healing Potion or Healthstone shortly before dying.

It shows facts and actionable warnings. There is deliberately **no score, ranking, or overall rating** of a booster.

#### Access — ADMIN and RAID_LEAD only

`canViewRunConsumableAudit` / `assertCanViewRunConsumableAudit` (`src/auth/authorization.ts`) is the single rule. It is the Run-management rule (`canManageRun`), unchanged:

| Account | Access |
| --- | --- |
| ADMIN / OWNER | every Run |
| RAID_LEAD | only Runs they lead (`run.raidLeadId`) |
| USER | never — not even when listed as the Run's raid lead |

Enforcement is server-side, before any audit read or Warcraft Logs request:

- **Run detail** — `runDetailService.getRunDetail` sets `consumables` via `runConsumableAuditService.getAuditViewForRunDetail`, which returns `null` without reading the audit tables for anyone else. A USER's serialized page payload contains no audit data, heading, placeholder or controls; the **Consumables** tab only exists when `consumables` is present.
- **Reads** — `runConsumableAuditService.getAuditView` asserts access first.
- **Mutations** — `attachRunWarcraftLogsReportAction`, `rescanRunWarcraftLogsAction`, `detachRunWarcraftLogsReportAction`, `decideRunWarcraftLogsFightAction`, `analyzeRunConsumablesAction` → `runWarcraftLogsService` / `runConsumableAuditService`, which assert access before any database read of associations or the audit and before any WCL call. Unauthorized callers get the standard `NOT_AUTHORIZED` (403) result and cause no Warcraft Logs traffic.
- **Moving a fight away from another Run** additionally requires permission to manage that other Run (a Raid Lead cannot pull fights out of another lead's Run).

There is no separate audit API route; the server actions are the only mutation surface.

#### Consumables: Workflow

1. A Run is **COMPLETED** (the tab is only offered then). Completion records `Run.completedAt`.
2. The Admin / Raid Lead opens **Consumables** on `/runs/[runId]` and pastes the Warcraft Logs report link (or code) — **Link & analyze**.
3. The report's boss fights are assigned to Runs (below); the audit is built from this Run's **ASSIGNED** fights only.
4. **Re-scan fights** re-fetches the report (new pulls uploaded) and re-assigns; **Re-analyze** rebuilds the audit from the current assignment; **Detach** removes the report from this Run. More than one report can be linked to a Run.
5. Page loads read stored data only — rendering the Run never calls Warcraft Logs.

A 60-second cooldown per Run (`WCL_RUN_ACTION_COOLDOWN_SECONDS`) covers every WCL-triggering action and protects the shared WCL rate limit.

#### Automatic linking and audit

A trusted log bot posts a report link → the report is linked with `source = DISCORD_BOT` → Run COMPLETED → the audit runs automatically. Two sources share one link path (`linkDiscoveredReport`):

- **Dedicated log channel** (`DISCORD_WCL_REPORT_CHANNEL_IDS`, a trusted log webhook posts every Run's report there). The message names no Run, so the server decides — never by "newest" or "closest" Run (`wcl-report-discovery.ts`, `warcraftLogsDiscoveryService`):
  1. The bot reads the channel **once** per pass from a durable cursor (`DiscordChannelScanCursor`) and hands trusted links to `POST /api/bot/warcraft-logs/discoveries`; the server re-checks channel and author and records the link once per message + report (`WarcraftLogsReportDiscovery`).
  2. On the ~5-minute tick (before the auto-audit, own advisory lock, ≤ 5 per pass) each due link is evaluated with **the same fight assignment as below**: absolute fight times inside a Run's window, content + difficulty, roster overlap for overlapping windows. It is linked to **every COMPLETED Run** that gets ASSIGNED or NEEDS_REVIEW fights — one report can hold several Runs, and each keeps only its own fights.
  3. States: `PENDING` (no boss fights yet, the Run still in progress, no Run matched yet, WCL unreachable or not showing the report — WCL answers alike for a missing, a private and a not-yet-visible report — retried), `MATCHED`, `NEEDS_REVIEW` (linked; ambiguous fights wait for a manager on the Run page — nothing is chosen for them), `IGNORED` (never linked and still unmatched / not found 3 days after the post — not retried). Once linked, a discovery stays `MATCHED` / `NEEDS_REVIEW`. Retries: every 15 min while a Run is open or the report still grows (a later Run in the same report is still found), then backing off up to 6 h; everything settles after 3 days. A report already linked to a Run (manually or from its channel) is simply `MATCHED` — no second link, no reset of the audit's attempts. A new link never brings the audit forward: it still waits until `completedAt` + 15 min.
- **Run's own channel**: a trusted link posted there is linked to that Run directly (as before).

- **Trust**: only authors in `DISCORD_WCL_REPORT_AUTHOR_IDS`, only in a configured log channel or the Run's own channel (IN_PROGRESS / COMPLETED Runs); centrally found reports are only linked to COMPLETED Runs — all re-checked server-side. Details in [Warcraft Logs report links (log bot)](#warcraft-logs-report-links-log-bot).
- **No assignment while running**: the Run's window closes at completion, so fights are assigned by the automatic audit.
- **Automatic audit** (`CONSUMABLE_AUTO_AUDIT_POLICY`, `autoAuditState`, `runConsumableAutoAuditService`): one pure rule decides for both the job and the Run page, from persisted timestamps only (no in-memory timers). A COMPLETED Run with a recorded `completedAt` becomes due **15 min** after completion (late uploads reach WCL first) when it has a linked report and **no successful analysis covers every linked report**. The pass re-fetches the reports, assigns fights (ambiguous ones stay in review) and analyzes the ASSIGNED fights as a system action (`autoAnalyzed`, no `analyzedBy`). Due Runs are processed earliest-due first, ≤ 3 per pass; overlapping passes are skipped by an advisory lock (`CONSUMABLE_AUTO_AUDIT_LOCK_KEY`); Runs completed more than 3 days ago are never picked up.
- **Report arrives late**: no report at +15 min means nothing is due and no attempt is spent. As soon as a report is linked (log bot, final pre-archive scan, or manually), the next pass audits it — no manual step.
- **New report after an analysis**: a report linked after the latest successful analysis (automatic or manual) makes the Run due again (`reason: NEW_REPORT`); the log-bot attach restarts the attempt budget (`resetAutoAttempts`). Re-linking the same report is a no-op. MANUAL fight decisions survive the re-scan. A manager's analysis with no newer report is never redone automatically.
- **Retries**: attempts are 15 min apart, at most **4** per report generation. Permanent failures (`REPORT_NOT_FOUND` — private/unknown report, `NOT_CONFIGURED`) stop at once; transient ones (`WCL_UNAVAILABLE`, `NO_RELEVANT_FIGHTS` — last pulls not uploaded yet, internal errors) are retried. An attempt is counted before any WCL call, so a crash can never loop.
- **Logs**: `[consumable-auto-audit] start|analyzed|failed|error { runId, reports, reason, fights, failure, retryable }` — never tokens or secrets.
- The Consumables tab shows "via Discord log bot", "Automatic analysis scheduled from …", "automatic re-analysis scheduled" (new report), "Analyzed automatically after completion", or that the automatic analysis stopped (permanent failure) / gave up after its attempts.

#### Report → fight → Run association

One Warcraft Logs report often holds several consecutive BoostingHub Runs — possibly with identical `RunRaidContent` (two Venomous 8/8 Runs back to back). Raid identity alone can never decide which fights belong to which Run, so every fight is associated explicitly (`src/domain/wcl-fight-assignment.ts`, pure):

1. **Time — primary.** WCL fight times are relative to the report start and are converted first: `absolute = report.startTime + fight.startTime`. A fight is a candidate when its absolute start lies in the Run's active window `[RunStartSnapshot.startedAt, Run.completedAt]` padded by `WCL_RUN_MATCH_TOLERANCE_SECONDS` (**300 s**, boundaries inclusive). The tolerance stays well below the usual gap between back-to-back boost Runs.
2. **RunRaidContent + difficulty — validation.** The encounter must belong to one of the Run's contents (catalog `warcraftLogsEncounterIds`; Bundles accept both Tidebound and Venomous encounters) at the Run's difficulty. In-window fights that fail this are **IGNORED**. Encounters the catalog does not know yet pass (time decides). Content never replaces time: two identical Runs stay separated by their windows.
3. **Roster overlap — disambiguation.** When other started Runs' windows also contain the fight (overlapping or unfinished Runs), the fight's players are compared with each Run's attendance roster (character name + realm — never display names; external boosters have no realm and never count). A Run wins only with ≥ 50 % of its roster present **and** a ≥ 30-point lead, and only when every compared Run has at least 3 identity-bearing roster members. A clear win for another Run marks the fight IGNORED here.

Wipes are fights like any other: every wipe in the window is assigned, so wipe deaths and recovery consumables are audited (the combat-potion requirement still applies to kills only — a separate rule).

##### Review instead of guessing

A fight becomes **NEEDS_REVIEW** — and is never audited until a manager decides — when:

- several Runs' windows match and the roster does not clearly decide;
- the Run's completion time was not recorded (`RUN_END_UNKNOWN`; open window of up to 8 h);
- the Run has no recorded window at all (completed before start snapshots / `completedAt` existed): every content-matching fight is offered for review (`RUN_WINDOW_UNKNOWN`);
- the only matching Run's roster is barely in the fight (< 25 %);
- another Run already holds the fight.

The review list shows concrete evidence ("Time matches Run", "Encounter matches Run content", "15/16 roster members in this fight", "Matches multiple Run time windows") — never a score. **Assign to this run** / **Remove from this run** are MANUAL decisions that survive re-scans.

##### Uniqueness

A `(report, fight)` pair is ASSIGNED to at most one Run — enforced by the partial unique index `run_wcl_fight_assigned_once` on `run_warcraft_logs_fight (reportId, wclFightId) WHERE status = 'ASSIGNED'`. Assigning a fight another Run holds is a **reassignment** in one transaction: the other Run's row becomes IGNORED (MANUAL). A concurrent double-assign fails on the index and rolls back.

##### Several reports for one Run

Several reports may be linked to one Run — different parts of it, overlapping parts, or two people logging the same raid. Every report keeps its association and fight rows (provenance stays visible); the **audit** uses each real pull exactly **once** — the union of unique pulls, never "one report only" (`src/domain/wcl-report-overlap.ts`, `realPullsOfRun`).

- **Same pull across two reports:** same encounter, difficulty, kill/wipe and raid content (when both known), durations within 2 s, and starts that differ by the report pair's **clock offset** within 2 s. Each logger stamps times with its own computer clock (production: 10.87–10.93 s apart on all 9 pulls, durations within 45 ms), so the offset is the start delta most same-shaped pairs agree on — never "equal timestamps". A single shared pull only matches when both copies overlap in absolute time (two distinct pulls of one raid never overlap). Fights of one report are never merged, so repeated pulls and close wipes stay separate.
- **Which copy counts:** more identified roster players; then the report covering more of the Run (identical reports → one report's events, one request); then the earlier link; then the report code. A kept copy is **incomplete** when an audited booster took part in the pull without a CombatantInfo snapshot (a `PARTICIPANT` fact instead of `COMBATANT`) or it has no snapshot at all; only then are the other loggers' copies of just those pulls read (one extra request per report) and the copy with the most snapshots kept — ties keep the ranking. The expectation is the audit's own participants, not the fight assignment's `rosterMatched` (which also counts lootbuddies). One pull's facts always come from one copy — never CAST from one logger and COMBATANT from another.
- The Warcraft Logs panel shows "… fights also logged in another linked report — counted once in the audit". **Staleness** uses the same projection, so a fresh analysis is never stale; manual and automatic analysis share `analyzeRun`.

#### What is checked

Only the Run's **ASSIGNED boss fights** (kills and wipes) are audited; trash is ignored. WCL is asked for exactly those fight ids (deaths, pull snapshots); consumable casts are fetched for their time range and then attributed to those fights only, so nothing from another Run in the same report can enter the audit.

Audited players are **attended BOOSTER roster participants** (`PRESENT`, `LATE`, `LEFT_EARLY`) plus the roster's external BOOSTERs. Lootbuddies, no-shows, excused and standby rows are not audited.

**Role = the role played in the log, not the roster role.** Warcraft Logs' CombatantInfo snapshot at each pull carries the specialization the player played in that fight (`specID`, Blizzard's `ChrSpecialization` id). It is stored per fight on the `COMBATANT` fact and mapped to a role through the specialization catalog (`specializationById` in `src/lib/wow-specializations.ts`; 40 retail specs, checked against the game table). No extra WCL request: these are the snapshots already fetched for flasks and gear. The **Role** column shows the played role: one role when every fight with a snapshot agrees, **Mixed** when they differ, **Unknown** without a usable specialization (no snapshot, an unknown spec id, or one of another class — never guessed from class, potions or damage). A differing roster role is shown beneath as information only ("roster Healer") and is never a warning. Roster, signup and attendance keep using the roster role; the log never rewrites it.

| Check | Rule | Status |
| --- | --- | --- |
| Flask | Flask aura active **at pull**, per fight (WCL CombatantInfo snapshot) | PASS if present in every snapshot; WARNING lists fights without one; UNKNOWN without snapshots |
| Combat Potion | At least one accepted potion per boss **kill** the player was in. Wipes are listed but never required; no "use every cooldown" rule | PASS / WARNING (lists kills without one) / N/A (no kills) / UNKNOWN (no played role in any kill) |
| Healing Potion | Uses are listed | Never a failure on its own — NEUTRAL with 0 uses; WARNING only via a death |
| Healthstone | Uses are listed | Never a failure on its own — NEUTRAL / N/A when not applicable; WARNING only via a death |
| Deaths | Each death evaluated independently (below) | WARNING per missing recovery consumable |
| Food | "Well Fed" / "Hearty Well Fed" buff **at pull**, per fight (like the flask) | PASS / WARNING (lists fights) / UNKNOWN without snapshots |
| Weapon | Per fight, every weapon carries an oil or stone, the class's own imbue, or a Runeforge (below) | PASS (shows what: Oil, Stone, Shaman imbue, Lightsmith rite, Runeforge) / WARNING (fight + slot) / N/A / UNKNOWN |
| Augment Rune | Rune buff at pull, per fight | **Optional — information only**: Present / Present 1/2 / Absent / Unknown. Never PASS or WARNING, never counted in warnings or compliance (≈ 12 % of players use one) |
| Vantus Rune | "Vantus Rune: <boss>" buff at pull, per fight | **Optional — information only** (boss-specific), same display and rules as the Augment Rune |
| Enchants | Gear Readiness — a permanent enchant on every equipped enchantable slot (below) | PASS `8/8` / WARNING `7/8` + missing slots / N/A / UNKNOWN |
| Gems | Gear Readiness — every socket that **exists** on an equipped item holds a gem (below) | PASS `3/3` / WARNING `2/3` + empty slots / N/A `0 sockets` / UNKNOWN |

##### Weapon enhancement — class-aware

One rule (`resolveWeaponEnhancementRequirement`, `src/domain/gear-readiness-policy.ts`) with the game data kept apart (`src/lib/wow-gear-catalog.ts`). Per weapon, from the CombatantInfo gear at pull:

| Weapon has | Result |
| --- | --- |
| an oil / stone temporary enchant (Thalassian Phoenix Oil, Oil of Dawn, whetstone) | pass — `Oil` / `Stone` |
| the class's own imbue as its temporary enchant: Shaman **Flametongue / Windfury / Earthliving Weapon**, Paladin Lightsmith **Rite of Sanctification / Adjuration** | pass — `Shaman imbue` / `Lightsmith rite` |
| **Death Knight**: a **Runeforge** as permanent enchant (with or without an oil) | pass — `Runeforge` |
| **Death Knight**: no Runeforge (an oil or a normal weapon enchant does not replace it) | missing — `Missing Runeforge` |
| a temporary enchant the catalog does not know yet | pass — present, never missing |
| nothing | missing |

- **Death Knights never need an oil** (product decision): the Runeforge is their required weapon enhancement; an oil next to it is optional. Dual-wield: each weapon needs its own Runeforge. A weapon without one is reported once, as "Missing Runeforge" — never as a missing oil, and not a second time by the enchant check (`checkedAsWeapon`). A Runeforge also counts as the weapon enchant. The class decides this in one place (`expectedWeaponEnhancement`, `RUNEFORGE_CLASSES`); with the class unknown, a Runeforge id still passes.
- Class imbues use the weapon's single temporary-enchant slot, the same one an oil uses — the game never stacks both, so either satisfies it; nothing ever requires both.
- **Hero Talents are never interpreted.** A Lightsmith rite is visible as the weapon's temporary enchant itself (WCL `talentTree` only holds trait entry ids). A Paladin with neither a rite nor an oil has nothing on the weapon, whatever the talents.
- **Off-hand**: checked only when it is known to be a weapon — a weapon enchant or enhancement on it, or a class that can hold nothing else there (Rogue, Demon Hunter, Death Knight). A Shaman shield imbue (Tidecaller's Guard, Thunderstrike Ward) marks a shield. Otherwise (shield or off-hand frill possible) it is "not checked", never missing.
- Evidence (Sept 2026, 1 419 players in 75 public Venomous Abyss reports): 16 of 162 Paladins had no rite and no oil and no weapon-related aura — a genuine miss.

#### Gear Readiness

Enchants and gems are judged on the player's **latest audited snapshot** (gear at the last pull). Facts are stored per fight (`RunConsumableAuditGearItem`), statuses derived at read time. Only *presence* is checked — which enchant or gem is best is not judged.

- **Enchantable slots** (Midnight, `ENCHANTABLE_ARMOR_SLOTS`): Head, Shoulders, Chest, Legs, Feet, Ring 1, Ring 2, plus the main hand and a weapon off-hand. In the evidence set these carry an enchant 80–93 % of the time; neck, waist, wrists, hands, back, trinkets 0 %. A Runeforge counts as the weapon enchant (no double failure with the weapon check).
- **Sockets**: Warcraft Logs reports the filled gems but not an item's sockets. The socket count comes from Blizzard's game data (`src/lib/wow-item-sockets.data.json`, client build 12.1.5): base sockets of the item (`ItemSparse.SocketType`) plus sockets added by its bonus lists (`ItemBonus` type 6). Validated on 23 193 equipped items: no item ever showed more gems than computed sockets. The count is always the actual item's — never assumed from its slot: a neck can have 0, 1 or 2 sockets (e.g. the Ula'tek neck 268265: 1 base socket + 1 from bonus 13668). An item **newer than the table** (id above its recorded `maxKnownItemId`, from Blizzard's `Item` table) or whose gems the table cannot explain is **unknown** ("Socket count unavailable"), never "empty socket". The table is checked in; the audit never calls wago.tools at runtime. Regenerate after a content patch: `node scripts/generate-wow-item-sockets.mjs`.

##### Combat potion by role

| Role | Accepted |
| --- | --- |
| Tank | Damage Potion |
| DPS | Damage Potion |
| Healer | Damage Potion **or** Mana Potion |

Each kill is judged with the role **played in that kill** (a priest who healed boss 1 and played Shadow on boss 2 is judged as a healer on boss 1 and as DPS on boss 2 — a Mixed role is never collapsed into one). A kill without a usable played role is not judged ("Not judged", never a warning). A healer never fails for choosing a Mana Potion. Mana Potions are identified by their cast, never inferred from a mana increase. Configured in `CONSUMABLE_AUDIT_POLICY.combatPotionByRole`.

**Older analyses.** `RunConsumableAudit.factsVersion` records the shape of the stored facts (`CONSUMABLE_AUDIT_FACTS_VERSION`). Version 3 adds personal defensive casts; a version-2 snapshot shows defensives as unknown and asks for a re-analysis. A snapshot from before played roles (version 1) has no specializations: its roles show as Unknown, no role-based potion expectation applies, and the page asks for a re-analysis. The stored roster role is never reinterpreted as a played role, and the migration fetches nothing from Warcraft Logs.

A catalog cast up to 5 s before a pull (`CONSUMABLE_PRE_PULL_WINDOW_MS`) counts for that fight as a pre-pull use (shown as a negative time, e.g. `-00:02`).

#### Death analysis

For every death, the audit looks for the **latest** Healing Potion and Healthstone use by that player:

- within `CONSUMABLE_AUDIT_POLICY.deathLookbackSeconds` (**30 s**) before the death,
- in the same fight,
- and after that player's previous death in the same fight (a battle-ressed player dying again is not covered by the first use).

A consumable used early in a fight never satisfies a later death. Multiple deaths — across one fight or many encounters — are listed and judged separately, each with its encounter and fight-relative time (`Ula'tek · Pull 3 (wipe) @ 03:42`).

**Kill or wipe.** Every death shows whether its pull ended in a **Kill** or a **Wipe** (Warcraft Logs `kill`), and the Survival heading counts deaths in wipes and in kills. That is all a wipe means here: the log does not say when a wipe was called, so nothing is inferred about whether a player "should have survived". The fight result alone changes nothing: a death in a wipe is judged exactly like one in a kill — unless it happened during the boosting team's collapse (death context "part of raid wipe", below), which is shown but not judged. Combat potions are still only expected on kills.

**Part of raid wipe.** Deaths while the **boosting team** is collapsing at the end of a wipe are shown but not judged (`src/domain/wipe-collapse.ts`): what was used appears as usual, a missing Healing Potion / Healthstone reads "not detected · not judged during raid wipe" and is never a warning. The collapse is judged from the **audited boosters only** — matched, attended BOOSTER participants who took part in the pull; buyers (who may die on purpose while the boosters keep fighting), lootbuddies, unmatched players and external boosters without a Warcraft Logs identity count in neither numerator nor denominator. For a **wipe** with at least 5 such boosters, the onset is the earliest booster death with at least 3 different boosters dying within 10 s **and** at least half of the pull's boosters within 20 s; every booster death from there on is part of the raid wipe (also a trailing survivor dying much later), every earlier death is judged normally. A battle-ressed booster counts once for the thresholds, each death is still listed. Kills never have one. It is derived from the snapshot's own facts (participation and deaths of the kept copy of each pull), so no extra request and no stored state.

Why not Warcraft Logs' own cutoffs: `Report.events(wipeCutoff: N)` drops everything after the N-th death of **any** raid member (buyers included) and also cuts kills; `wipeCutoff: -1` has no effect there; the fight's `wipeCalledTime` is only set when a wipe is called in the Companion app — empty on all 122 wipes of 16 public Venomous Abyss reports and on production. Checked on one production report (14 boosters): Lost Explorers collapses at +11.9 s (13 boosters dead within 16 s); Sszorak at +112.5 s (7 boosters in 2.7 s) while the lone booster death at +26.6 s stays judged. The authoritative validation of this booster-only rule is the production case above plus the deterministic tests. Public logs have no BoostingHub roster, so they could only serve as a proxy with the whole raid as the population: in the raid wipes of 16 public Venomous Abyss reports no onset fell on an early mechanic cluster the raid fought on from, and 52 such early clusters were rejected by the 50 %-in-20 s rule (the only flagged cases came from a 5-player dungeon log, which the audit does not cover). That is evidence, not a measured false-positive rate.

**Personal defensives** (`src/lib/personal-defensive-catalog.ts`): the player's **own** defensive cooldown casts in the same window as the recovery checks (30 s, same fight, after an earlier death in it) — damage reductions, immunities, absorbs and major self-heals, 42 spell ids covering all 13 classes. Every id was seen being cast in real Midnight raid logs (16 Venomous Abyss reports) and matches the game's SpellName table; spells not seen there are left out rather than guessed. Excluded on purpose: externals (Pain Suppression, Ironbark, Blessing of Protection, and Lay on Hands, which is mostly cast on others), offensive cooldowns (e.g. Havoc Metamorphosis), utility (Fade) and secondary events of one use. The casts come from the same Casts stream (its filter is consumables + these ids), so there is no extra request; they are stored as `CAST` facts with category `PERSONAL_DEFENSIVE`, so no schema change.

Per death: **USED** (spell, time, seconds before death), **NOT_DETECTED** ("no tracked personal defensive detected in the previous 30 s"), or **UNKNOWN** (the snapshot predates defensive tracking, facts version < 3 — Re-analyze). This is **information only**: it never adds a warning. The log proves a defensive was cast, not that one was available or would have helped (talents, resets, cooldowns).

##### Healthstone applicability

Per fight, from the strongest evidence the log provides:

- **Applicable** — a Warlock took part, or anyone used a Healthstone in that fight.
- **Not applicable** — fight participants are known, no Warlock, and no Healthstone use seen. A death there shows N/A, never a warning.
- **Unknown** — WCL did not report the fight's participants. No warning.

##### Why "not used before death", never "failed to use"

Warcraft Logs records what was **cast**, not what was in a player's bags. The audit therefore only states facts — "No Healing Potion use detected before death" — and never claims a consumable was available. For the same reason, a player who never died is never flagged for not using a Healing Potion or Healthstone.

##### Unknown is never a failure

A check only warns on affirmative evidence that something is missing:

- **Log data unavailable** — the Character is not in the report (`NOT_IN_LOG`), or the booster has no character identity (`NO_CHARACTER_IDENTITY`: external boosters only carry a Discord name).
- **Unknown** flask / food — no CombatantInfo pull snapshot for that fight.
- **Weapon / Enchants / Gems unknown** — no gear in the log.
- **Off-hand not checked** — not known to be a weapon (shield or frill possible).
- **Sockets unknown** — the game data cannot explain the gems seen on an item.

#### Player matching

A Character is matched to a report actor by **name + realm within the report's region** (case-, accent-, space- and punctuation-insensitive; that is the in-game identity). A stored `Character.warcraftLogsId` found among the report's ranked characters is preferred (survives renames). Never by name alone. External boosters are never matched: their name is a Discord name with no realm.

#### Data model

Normalized **facts** are persisted; PASS/WARNING/N/A/UNKNOWN is evaluated at read time (`consumable-audit-policy.ts`), so changing a rule or the lookback never needs a new Warcraft Logs fetch.

| Model | Content |
| --- | --- |
| `WarcraftLogsReport` | shared report (`code` unique): title, absolute start/end, region, cached metadata JSON (boss fights, actors, ranked characters), `fetchedAt`. Reused by every Run on the report; deleted when the last Run detaches |
| `RunWarcraftLogsReport` | Run ↔ report association (`runId, reportId` unique): `source` (MANUAL / DISCORD_BOT), attached by (null for the log bot), Discord message id, last scan (null until first scanned) |
| `RunWarcraftLogsFight` | one report fight considered for one Run: WCL fight/encounter id, kill, relative and absolute times, `raidContentId`, `status` (ASSIGNED / NEEDS_REVIEW / IGNORED), `decision` (AUTO / MANUAL), evidence codes, roster overlap |
| `RunConsumableAudit` | one per Run (`runId` unique): last successful analysis (`autoAnalyzed` when automatic), last attempt, safe failure code, automatic attempts, `factsVersion` |
| `RunConsumableAuditFight` | audited fight snapshot (`auditId, reportCode, wclFightId` unique), Warlock presence, Healthstone use seen |
| `RunConsumableAuditPlayer` | audited booster snapshot: attendance / external booster link, names, class, roster role (reference only), match status, WCL actor id |
| `RunConsumableAuditObservation` | one fact per player per fight: `COMBATANT` / `PARTICIPANT` presence, `AURA` (flask, food, augment rune, Vantus rune at pull), `CAST` (potion/Healthstone), `DEATH`; report-relative `atMs`; `specId` on `COMBATANT` = specialization played in that fight |
| `RunConsumableAuditGearItem` | Gear Readiness fact per player per fight: WCL gear slot, item id, permanent / temporary enchant id, gem count, socket count (null = unknown). Only enchantable slots, weapons and socketed items |
| `Run.completedAt` | set on IN_PROGRESS → COMPLETED; closes the Run's active window |

A successful analysis replaces all audit fights/players/observations in one transaction (idempotent). A failed analysis or re-scan keeps the previous snapshot and associations untouched. When the assignment changes after an analysis, the view flags the audit as stale until **Re-analyze**. Deleting a Run cascades to its associations, fight rows and audit; other Runs' use of the same report is unaffected.

#### Warcraft Logs requests

Via `warcraftLogsApiClient` (shared client-credentials token cache, typed results, never throws for business outcomes):

- **Link / Re-scan** — `fetchReportMetadata`: one GraphQL request per report (fights, player actors, ranked characters, region). Linking a report another Run fetched in the last 10 min (`WCL_REPORT_METADATA_REUSE_SECONDS`) reuses the stored metadata — no request.
- **Analyze** — `fetchReportConsumableEvents`: one GraphQL request per linked report with three aliased streams for the Run's assigned fights: `Casts` (filtered server-side to catalog spell ids, time-windowed incl. 5 s pre-pull), `Deaths` (friendly), `CombatantInfo` (reduced to aura ids on receipt). Only a stream with `nextPageTimestamp` is re-requested.

Never one request per player, death, or Run fight. Report requests use a 45 s timeout; failures map to `WCL_UNAVAILABLE`.

#### Consumable catalog

`src/lib/consumable-catalog.ts` is the single list of supported consumables: category (`FLASK`, `DAMAGE_POTION`, `MANA_POTION`, `HEALING_POTION`, `HEALTHSTONE`), spell id, name, expansion. Business logic only reads categories.

The Midnight ids were taken from public Venomous Abyss reports (WCL zone 53) through the WCL v2 API: `masterData.abilities` for names, cast events joined to CombatantInfo `specID` to classify potions by who uses them (healer-only → Mana Potion), and CombatantInfo `auras` for flasks. Ids that could not be classified from that evidence are left out rather than guessed.

**Combat potions** (`DAMAGE_POTION`): Potion of Recklessness `1236994`, Draught of Rampant Abandon `1236998`, Light's Potential `1236616` (primary stat), Potion of Zealotry `1238443` (damage proc; from game data, not yet seen in logs). Entries are the potion's **use spell** (the WCL `abilityGameID`), never an item id. A Midnight Potion Cauldron hands out "Fleeting" potions that cast the **same spell** as the tradable ones (Blizzard `ItemEffect`: e.g. Light's Potential items 241308/241309 and Fleeting 245897/245898 all cast `1236616`; Warcraft Logs shows one ability for both), so one row covers both. The cauldron's own "Prepare Midnight Potion Cauldron" spells are not consumables.

To add a consumable (new season, new rank): add a catalog row with its source. To add a new check category later (food, weapon oil, rune, defensives): add the category + evidence type to the catalog and a rule to the policy — the observation table stores `category` as text, so no enum migration is needed.

### User settings and notifications

#### Notifications: Purpose

BoostingHub separates **Profile** (identity / account operations) from **Settings**
(user-controlled application preferences).

Settings sections:

1. **Notifications** — Discord DM delivery preferences (in-app is always on)
2. **Regional** — personal IANA timezone
3. **Gameplay** — Default Character preference for signup UX
4. **Active sessions** — list and revoke signed-in devices (via Prisma; revoke via Better Auth)

| Type | When created | Web | Run channel | Discord DM |
| --- | --- | --- | --- | --- |
| `ROSTER_SELECTED` | **Save Roster** or publish, for selected signups not already told they are in | Always | — | Master + `dmRosterSelectedEnabled` + Discord linked |
| `RAID_INVITE` | **Start Run** for each SELECTED signup | Always | — | Master + `dmRaidInviteEnabled` + Discord linked |
| `RUN_CANCELLED` | Run → `CANCELLED` for Users with PENDING/SELECTED | Always | YES if dedicated channel exists (before retirement) | Master + `dmRunCancelledEnabled` + Discord linked |
| `RUN_RESCHEDULED` | `scheduledStartAt` actually changes | Always | YES if dedicated channel exists | Master + `dmRunRescheduledEnabled` + Discord linked |
| `RUN_SCOPE_CHANGED` | Edit Run materially changes the planned raid scope (`RunRaidContent` by raidId: boss count changed, content added/removed) on a non-DRAFT Run — for every User still signed up (PENDING / SELECTED / NOT_SELECTED, incl. draft picks; WITHDRAWN excluded). A reorder or same-count save is a no-op. | Always | YES if dedicated channel exists ("⚠️ Run Updated", changed contents only) | Master + `dmRunRescheduledEnabled` ("Run Rescheduled / Updated DMs") + Discord linked |
| `ROSTER_WITHDRAWN` | To the Run's **Raid Lead** when a picked player withdraws (with their reason, links the Roster tab) | Always | — | Master + Discord linked (no per-event toggle) |
| `ROSTER_CHARACTER_SAVED` | The Character sync (every 15 min, `rosterSavedNoticeService`) **newly observes** a kill on a **planned** boss (first `plannedBossCount` bosses of a content, same difficulty and raid ID) for a Character that is **draft-selected or SELECTED** on a Run that has not started yet (OPEN / ROSTERING / PUBLISHED). To the Character's **owner** ("no loot there, contact the Raid Lead", links the Run) and the Run's **Raid Lead** ("check the roster", links the Roster tab); once if they are the same User. A Character already saved when it was picked never triggers it (only new kills count); kills during the Run (IN_PROGRESS) never do. A further kill notifies again with the full boss list. The DM is skipped if the Run started before delivery (Quiet Hours). **Also at Start Run** (`runStartSavedCheckService`): after a fresh sync of the SELECTED Characters, a reminder to each owner saved on a planned boss ("Reminder: you are saved") — decided by the same rule as the roster warning and Auto Build (`savedPlannedBosses` → `isSaveRelevantToPlannedBosses`): per boss on Normal / Heroic, the whole content on Mythic; a full clear or progress with an unknown / inconsistent boss list counts and, when no killed planned boss can be named, lists every planned boss of that content and **one grouped summary to the Raid Lead** ("Selected Characters are saved", one line per affected Character, Roster tab); their DMs are only sent while the Run is IN_PROGRESS. | Always | — | Master + Discord linked (no per-event toggle) |
| `ROSTER_REMOVED` | **Save Roster** or publish, for signups last told they are in that are no longer selected (not WITHDRAWN) | Always (except character-swap bookkeeping, below) | — | Master + `dmRosterRemovedEnabled` + Discord linked |

**Booster character swap.** When a player's booster character is exchanged for
another of their booster signups (same User, same Run), the player gets exactly
**one** user-facing notification: a `ROSTER_SELECTED` with a `roster-swapped:`
source key, titled **"Roster updated"**, which also drives the single
"Roster Update" DM (subject to `dmRosterSelectedEnabled`). The old character's
`ROSTER_REMOVED` is still written, but only as hidden bookkeeping state
(`visibleInApp = false`, `SKIPPED`, already read): it is never shown in the bell
or on `/notifications`, never counts as unread, and never sends a removal DM.
It exists so later Save Roster / Publish runs know that signup was already
taken out. A genuine removal (no other booster signup of the player stays
selected) and every Lootbuddy removal remain normal visible notifications.

##### In-app visibility (`visibleInApp`)

`UserNotification.visibleInApp` (default `true`) separates user-facing
notifications from internal notification-state rows. Every user-facing
repository read — `countUnreadForUser`, `listLatestForUser`, `listForUser`,
`findOwned` (and so `markRead`), `markAllRead` — filters `visibleInApp = true`
in the query itself, so the bell's "latest 5" and the page's limit count visible
rows only. Being read is not the same as being hidden. Internal roster state
(`notifyRosterSelectionChangesInTx`) reads `UserNotification` directly and still
sees hidden rows. The `add_notification_visible_in_app` migration backfilled
`visibleInApp = false` only for historical removals provably paired with a
same-user/run/version `roster-swapped:` event and created already read with no
DM; every other historical row stayed visible.

**Run channel announcements** (`RunDiscordAnnouncement`) are shared Run communication.
They are **not** controlled by User DM preferences (`discordDmEnabled=false` does not
suppress the channel post). They use deterministic `sourceKey` values distinct from
UserNotification keys:

- Reschedule: `run-rescheduled:<runId>:<scheduleRevision>`
- **Durability:** `RUN_RESCHEDULED` and `RUN_SCOPE_CHANGED` UserNotifications are written inside the same Edit Run transaction as the Run fields / `RunRaidContent`, the revision bump and the announcement (`updatePreStartAtomic` → `writeInTx`). Recipients and DM preferences / Quiet Hours are read with that transaction's client, so the audience is the signup state at commit time; a committed change can never lack its DM intent. `RUN_CANCELLED` / `RUN_REACTIVATED` follow the same rule: they are written inside the cancel / reactivate transaction (with the status change, `cancelRevision` and the announcement), including retiring the opposite cycle's still-undelivered DMs (`SKIPPED`).
- Scope change: `run-scope-changed:<runId>:<contentRevision>` — the row's `scopeChanges` JSON (before → after per changed content) is the single structured snapshot; that revision's `RUN_SCOPE_CHANGED` DMs (`run-scope-changed:<runId>:<contentRevision>:<userId>`) render from it. `Run.contentRevision` increments only on a material scope change.
- Cancel: `run-cancelled:<runId>`

No historical backfill — only lifecycle events after deployment create rows. Account-level notifications without a Run (for example `CHARACTER_BATTLENET_REPAIR`) reach the bot through the separate `accountNotificationDms` lane and record their outcome through `PUT /api/bot/notifications/:notificationId/delivery`.

#### Settings ownership

Route: `/settings`

Sidebar: **Settings** (after Profile).

Only the authenticated owner may view or update their settings.

#### Notifications: Preferences

Stored on `User`:

- `discordDmEnabled` (default `true`) — master override; does not rewrite per-event toggles
- `dmRosterSelectedEnabled` / `dmRaidInviteEnabled` / `dmRunCancelledEnabled` /
  `dmRunRescheduledEnabled` / `dmRosterRemovedEnabled` (default `true`)
- `timeZone` (default `Europe/Berlin`) — personal presentation only
- `defaultCharacterId` (nullable) — signup UX preference only
- `discordRunChannelNickname` — deprecated, no longer read or written (the Raid
  Lead name comes from Discord, see domain model); dropped by a follow-up migration.
- `discordDmQuietHoursEnabled` (default `false`) — defer optional personal Discord
  DMs during a daily local window
- `discordDmQuietHoursStart` / `discordDmQuietHoursEnd` (nullable `HH:MM`) —
  local wall-clock window interpreted in `User.timeZone` (Regional Settings)

##### Effective Discord DM rule

At creation:

`discordDmEnabled AND eventSpecificDmEnabled AND usable Discord identity`

→ `PENDING`, else `SKIPPED`. Snapshotted; never re-evaluated later.

When effective DM is `PENDING` and Quiet Hours are enabled, the current local time
(in `User.timeZone`) is evaluated once at creation. Inside the window,
`discordDeliverAfter` is set to the next local end time (exclusive boundary)
converted to UTC; outside the window it stays `null` (immediately eligible).
Quiet Hours never turn an intended DM into `SKIPPED`.

`PENDING` means delivery is still expected. When the DM lane finds a `PENDING`
notification whose Run is app-archived (or gone), it can never be delivered:
the sync pass moves it `PENDING → SKIPPED` (compare-and-set, no Discord request,
no ERROR log) for every Run notification type, instead of leaving it queued
forever. The bot's pre-send delivery authority also refuses an archived Run's
DM, so archival between listing and sending cannot deliver it. `SENT` /
`FAILED_PERMANENT` / `SKIPPED` rows are never touched.

#### Quiet Hours

Personal Discord DMs only. In-app notifications, shared Run-channel messages,
`RunDiscordAnnouncement` lifecycle posts, channel provisioning, and role pings are
never delayed or suppressed.

- **Timezone authority:** `User.timeZone` (Regional Settings). Times are stored as
  `HH:MM` local wall clock, not UTC offsets.
- **Window semantics:** start inclusive, end exclusive. Same-day (`13:00`→`15:00`)
  and overnight (`22:00`→`07:00`) windows are supported. `start === end` is rejected.
- **DST:** end instants are derived via IANA timezone rules. Spring-forward
  nonexistent local times resolve to the first valid instant at or after the
  requested wall clock; fall-back ambiguous times prefer the **later** occurrence so
  the quiet period is not shortened.
- **Snapshot:** `discordDeliverAfter` on `UserNotification` is fixed at event
  creation. Disabling Quiet Hours, changing start/end, or changing timezone later
  does **not** retroactively alter existing rows.
- **Bot delivery:** the existing `notificationDms` lane selects `PENDING` rows where
  `discordDeliverAfter IS NULL OR discordDeliverAfter <= now` (bounded query). No
  per-notification timers.

#### Idempotency (`sourceKey`)

- Roster pick: `roster-selected:<runId>:<publishedVersion>:<signupId>`
- Roster removed: `roster-removed:<runId>:<publishedVersion>:<signupId>`
- Roster update (booster character swap): `roster-swapped:<runId>:<publishedVersion>:<signupId>`
- Raid invite: `raid-invite:<runId>:<signupId>`
- Run cancelled: `run-cancelled:<runId>:<userId>`
- Run rescheduled: `run-rescheduled:<runId>:<scheduleRevision>:<userId>`
- Picked Character saved: `roster-character-saved:<signupId>:<sorted saved planned boss ids>:<player|lead|start>`
- Start Run Raid Lead summary: `roster-character-saved-summary:<runId>:<sha256 of the sorted affected set (signupId=bossIds)>` — the same set never notifies twice

`Run.scheduleRevision` increments only when `scheduledStartAt` changes.

#### Community timezone authority

User timezone must **not** alter:

- generated `Run.title`
- Discord channel names
- raid-ID week boundaries / CURRENT/NEXT classification

Shared Discord channel posts prefer Discord native timestamps (`<t:UNIX:F>`)
where appropriate. Personal DMs also prefer native timestamps.

#### Default Character

Preference only. Never bypasses the Booster role, difficulty,
weekly availability, lockouts, cross-run reservations, role validity, or active
state. Existing active signup state wins over the preference. Never auto-submits.

#### Notifications: Surfaces

- Header bell (latest 5 visible + unread count of visible rows) → `/notifications` (same visibility)
- Settings → Notifications / Regional / Gameplay / Active sessions
- Controllers: `settings.actions.ts`, `notification.actions.ts`, `session.actions.ts`
- Services: `settingsService`, `notificationService`, `runLifecycleNotificationService`, `sessionManagementService`

### Discord bot

#### Discord bot: Purpose

Discord is a second interaction surface for the exact same signup domain the Web app uses — never a parallel implementation. A User may sign up through the Web dialog or through a Discord Run embed; both manipulate the same `RunSignup` rows through `signupService.setCharacterOffers` / `setLootbuddies` / `cancelBoosterSignup`. There is no separate "Discord signup" record.

#### Discord bot: Architecture

```text
Discord
  → Discord Bot process (src/discord-bot/*, discord.js)
  → Bot API (src/app/api/bot/*, Next.js Route Handlers)
  → Service (signupService, discordSyncService)
  → Repository → PostgreSQL
```

The bot never connects to PostgreSQL and never imports a Repository or Service directly. Everything it knows about BoostingHub comes from the Bot API, so Web and Discord can never drift into different eligibility rules.

Same repository, separate long-lived process: `src/discord-bot/` holds the bot's own entrypoint, run independently of the Next.js app (`npm run bot:start`). It may import shared pure types/enums for compile-time safety but must not import `@/services/*` or `@/repositories/*` for execution — only `@/discord-bot/bot-api-client.ts` talks to BoostingHub, over HTTP.

#### Warcraft Logs report links (log bot)

A trusted log bot's Warcraft Logs report links are linked to Runs automatically (`src/discord-bot/warcraft-logs-links.ts`). Two sources:

- **Dedicated log channels** (`DISCORD_WCL_REPORT_CHANNEL_IDS`; a trusted log webhook posts every Run's report into one channel). `scanReportChannels` reads each configured channel **once** per sync pass (not once per Run), at most once a minute, ≤ 10 pages, from the durable cursor the sync work hands it (`warcraftLogsReportChannels`; first read 3 days back). Trusted links go to `POST /api/bot/warcraft-logs/discoveries`; the cursor (`PUT /api/bot/warcraft-logs/channels/:channelId/cursor`, forward-only) only passes messages the server accepted or permanently refused. A message whose link fails transiently (transport, 401, 429, 5xx) is read again next pass while later messages are still delivered; after 3 days it is given up, so one bad message can never wedge the channel. The bot never matches Runs — the server does (see [Automatic linking and audit](#automatic-linking-and-audit)). The log channel never holds back any Run channel's archival.
- **A Run's own channel** — the per-Run scan below.

- **Who is trusted**: only messages whose `author.id` is in `DISCORD_WCL_REPORT_AUTHOR_IDS` (web app env; empty = feature off). `author.id` is the narrowest id every message carries: a bot's user id, or — for a webhook post — the webhook id itself (Discord sets `author.id = webhook_id`). A look-alike webhook/bot with the same display name has a different id. The sync payload hands the list to the bot (`warcraftLogsReportAuthorIds`) and flags channels to read (`scanWarcraftLogs`: IN_PROGRESS or COMPLETED Runs). A booster posting a link attaches nothing.
- **How — lossless cursor scan, no new gateway intent**: every message after a durable per-channel cursor (`RunDiscordPost.warcraftLogsScanCursor`) is read over REST with `after=<cursor>`, 100 per page, oldest → newest (≤ 10 pages per routine pass, at most once a minute per channel, `WCL_CHANNEL_SCAN_INTERVAL_MS`). Before the first scan the cursor is a snowflake at Run start − 10 min, so nothing posted during the Run is skipped however busy the channel is. The cursor is saved via `discord-state` `wcl-scan-cursor` (server: forward-only, current Run channel only) and never advances past a trusted link whose attach must be retried (WCL unavailable / not configured, Bot API unreachable, 401, 429, 5xx); a missing/private report and a permanent Bot API rejection (400/403/404/409/422 — e.g. the channel is no longer the Run's channel) are final and skipped. Content, embed title/description/url and fields are searched for retail report links.
- **Before deletion**: a retiring (COMPLETED) channel gets an unthrottled final scan to its end (≤ 50 pages). If that cannot finish, the channel's transcript/delete is held back and retried next pass — at most 30 min (`WCL_FINAL_SCAN_MAX_DEFER_MS`), then retirement proceeds with a warning.
- **Discord requirement**: the app's **Message Content Intent** must be enabled in the Developer Portal (see [Discord Message Content access](OPERATIONS.md#discord-message-content-access-transcripts-and-log-bot-links)). Without it Discord returns empty `content`/`embeds`/`attachments`/`components`/`poll` over REST for other authors' messages — the scan then finds no link, attaches nothing and simply moves its cursor on (no retry, archival is never held back; manual linking still works). No gateway intent change is needed: the scan is REST-only. The bot logs its access once at startup (`Discord Message Content: AVAILABLE|UNAVAILABLE|UNKNOWN`, from the application flags — `src/discord-bot/message-content.ts`).
- **Server checks** (`runWarcraftLogsService.attachFromDiscord`): bot token, author in the allowlist, the message's channel is this Run's stored `runChannelId`, Run IN_PROGRESS or COMPLETED. Stored as `source = DISCORD_BOT` with the Discord message id and author id and no acting User. Idempotent: an already linked report causes no WCL request. A failed attach tells the bot whether to retry (`retryable`). Fights are not assigned while the Run runs (its window is still open). A **different** report never replaces an existing one (manual or earlier log-bot link): it is linked alongside, and the time-window fight assignment keeps any fights outside this Run out of its audit.
- **Logs**: one structured line per trusted link — `[discord-bot] warcraft-logs link { runId, channelId, messageId, authorId, reportCode, result }` with `result` = `attached` / `already-attached` / `retry` / `failed` / `rejected`. Untrusted authors' messages are skipped without logging. No tokens, secrets or headers are logged.
- **Player name refresh**: every 10 min (`DISCORD_MEMBER_NAME_REFRESH_INTERVAL_MS`, `src/discord-bot/member-name-refresh.ts`) the bot calls `/api/bot/discord/member-names`; the API decides who is due and reads the guild member. See the domain model's **Player names**.
- **Auto audit**: every 5 min (`WCL_AUTO_AUDIT_INTERVAL_MS`) the bot calls `/api/bot/warcraft-logs/auto-audit`; the API decides what is due. See [Automatic linking and audit](#automatic-linking-and-audit).

#### Sync architecture

Run/Signup/Roster state never depends synchronously on Discord. `discordSyncService.listSyncWork(now?)` (`src/services/discord-sync.service.ts`) is the single place that decides "something changed", and returns independent lanes including:

- **`channels`** — channel reconciliation (name, parent category, and CURRENT/NEXT section ordering) for every Run that already has a persisted `RunDiscordPost.runChannelId`. Completely unconditional: it does not depend on the signup/roster message being dirty, on `Run.status` (DRAFT included), or on anything else — a Run that already owns a dedicated channel always gets a `channels` item, every poll. See "Channel reconciliation" and "Weekly raid-ID sections" below.
- **`signups`** — a signature (`uniqueSignupCount:signupWindowOpen:runStatus:desiredChannelName:targetBucket`) is compared against `RunDiscordPost.lastSignupSignature`. DRAFT runs are never candidates. The *first* post additionally requires signup to be genuinely available right now (`isSignupWindowOpen` — OPEN / ROSTERING / PUBLISHED with `signupsOpen` true) **and** the Run's raid-ID week to currently classify CURRENT or NEXT (see "Weekly raid-ID sections") — a Run the bot first sees only after it already reached COMPLETED/CANCELLED (or PUBLISHED with signups already closed) never gets a brand-new post for a signup phase that's already over, and a Run scheduled further out than NEXT never gets Discord infrastructure before its week is actually current or upcoming. Once a post exists, later updates are unconditional (any non-DRAFT status, any week bucket), so the same message keeps reflecting the Run's real state — including signups closing, or the Run's own channel rolling from NEXT into CURRENT — all the way through completion. `desiredChannelName`/`targetBucket` are folded into the signature as legacy wake-up signals (historical: before `channels` existed, they were the only way a rename/section move ever got picked up) — kept for now as lower-risk, though `channels` is the actual authoritative fix; a rename, Archive/Restore, or weekly rollover no longer *depends* on them to reach the channel.
- **`roster`** — `RunRoster.version` is compared against `RunDiscordPost.lastRosterVersion`, and the bot's Guild emoji fingerprint against `lastRosterEmojiFingerprint`; only runs with a published roster are candidates.
- **`schedules`** — exactly two global Schedule work items (`CURRENT` + `NEXT`). Server-owned filter/sort/signature; bot creates/edits the persistent marker-channel messages. Independent of Run-channel archival — see "Persistent Schedule posts" under Weekly raid-ID sections.

`RunDiscordPost` (additive migrations `20260910T2332_discord_integration_state`, `20260911T0136_discord_run_channel`, `20260918T1525_add_run_discord_archive_artifacts`, and `20260918T1628_add_run_archive_transcript_html`) is small, presentation-only integration state — the channel/message ids the bot already created/posted (including one-time app-archive close/transcript message ids) plus the HTML transcript body for website download, so a restart reuses/edits them instead of duplicating. It is never a second source of truth for Run/Signup/Roster data.

**Which Runs are polled.** Each pass fully loads only Runs that can still produce Discord lifecycle work: OPEN/ROSTERING/PUBLISHED Runs (possible first signup provisioning — the week gate is applied per pass, so a FUTURE Run becomes eligible without any database write), unarchived IN_PROGRESS Runs (temporary Voice provisioning even before any Discord post exists), and every Run that still holds live Discord identity — a Run channel, a Voice channel, or a signup post identity (including a retired channel's leftover signup identity until the bot confirms the channel gone). Fully retired historical Runs, whose `RunDiscordPost` holds only history (Final Setup markers, archive transcript, Raid Invite history), are skipped entirely. Their Discord state is read for all polled Runs at once. Pending lifecycle announcements stay an independent lane: they are listed on their own and resolve the Run's current channel from that same read, even for a Run that is not otherwise polled.

The bot's `sync-loop.ts` polls `GET /api/bot/discord/sync` on an interval (`DISCORD_SYNC_INTERVAL_MS`, default 5s) and processes `channels` **before** `signups`/`roster`, so a Run's channel is already in its correct name/category/section before any new message work is applied. After Discord signup/lootbuddy/cancel mutations the bot also calls `requestImmediateSync()` so public embeds refresh without waiting for the next poll tick (concurrent kicks coalesce to one follow-up pass). The resolved channel ids from that pass are reused for the message paths (no duplicate rename/move for a Run that appears in more than one lane the same poll). A failed pass is logged and retried on the next tick — it never throws the process down or blocks a BoostingHub Run transition.

#### Per-Run Discord channel

Preferred mode: each Run that becomes signup-available gets its own dedicated Discord text channel, created under the ONE configured Run category (`DISCORD_RUN_CATEGORY_ID`) — CURRENT- and NEXT-week Runs share this same category (Discord channels cannot contain child channels, so there is no separate "NEXT category" — see "Weekly raid-ID sections" below) — so a community sees one channel per raid rather than one shared signup channel.

**Trigger**: the same gate as the first signup post (`isSignupWindowOpen`) **and** the Run's raid-ID week currently classifying CURRENT or NEXT — a Run is never given Discord infrastructure while still `DRAFT`, never retroactively for a Run that reached COMPLETED/CANCELLED (or PUBLISHED with signups already closed) without ever having been signup-available, and never while scheduled too far out to be CURRENT or NEXT yet.

**Naming**: `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`, pure and unit-tested) computes `{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}` in the community timezone (e.g. `sat-2200-hc-vip-7of9-lead`) from authoritative Run data. The Raid Lead segment is the Raid Lead's `User.name` (player name resolved from Discord, see domain model) — the same name the Run title and the web Run views show. The channel name follows the name live; `Run.title` of not-yet-ended Runs is re-titled when a Discord name refresh changes it. The name is projected via the `Run.raidLead` include — no per-Run lookup. Closed presentation (`buildClosedDiscordRunChannelName`, `closed-` prefix) applies when the Run is app-archived **or** status is COMPLETED/CANCELLED — naming is independent of destructive channel deletion. Grouping CURRENT/NEXT is expressed by section position, not the name.

**Identity**: `RunDiscordPost.runChannelId` is the only authoritative identity, recorded the instant the channel is created — before any message is posted into it, so a crash between creation and posting can never cause a retry to create a second channel. The channel is **never located by name** afterward, since a rename changes the name but not the id.

**Rename, not replace**: when the desired name changes (schedule / difficulty / loot / raid-lead edit — allowed until Start, `PUBLISHED` included), the sync pass calls `channel.setName(...)` on the *same* channel id, and the signup embed is edited in place (no re-announcement). A started / completed Run's fields are no longer editable, so historical channels are never renamed after the fact.

**Channel retirement (not clone)**: destructive TEXT-channel deletion is authorized **only** by explicit app archive (`Run.archivedAt != null`). COMPLETED / CANCELLED without archive keep the Discord text channel (closed naming only) so Cancel→Reactivate can continue in-place and late WCL/log-bot messages can still land. Terminal status alone, schedule PAST/FUTURE placement, Discord ARCHIVE-category holding, or pre-existing archive artifacts never authorize delete. When `archivedAt` is set (and no PENDING lifecycle announcements remain), the next sync pass posts Ticket-Tool archive artifacts to `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID`, then **deletes** the dedicated Run TEXT channel and records `channel-gone` for it (see *Retired channel identity* below). The Manawyrm Hub Run row itself remains stored as an archived Run. Weekly rollover for non-archived Runs still moves (never deletes) PAST/FUTURE channels into archive-category holding. A stored `runChannelId` is replaced with a newly created channel **only** when Discord confirms Unknown Channel (10003); Missing Access / rate limits / transient fetch failures keep the stored id and never recreate (avoids duplicate channels on bot restart). Channel reconciliation (name + category) records a confirmed Unknown Channel for a stored Run channel once as `channel-gone`, so a deleted channel stops coming back every poll; a channel that merely does not resolve (wrong type) keeps its stored id.

**Self-healing**: if the stored channel id no longer resolves in Discord (deleted out-of-band), the next sync pass creates a replacement rather than leaving the Run without a home — this is recovery, never the bot deleting anything itself. This self-healing is exclusive to the signup path (gated by `isSignupWindowOpen` + week bucket, same as first-channel provisioning); `channels` reconciliation and the roster path only reuse a channel that already exists — if a Run's channel is missing when only `channels`/roster work would have reached it, that item is skipped with a warning rather than provisioning anything.

**Raidboost Announce**: when the signup path creates a Run channel for the first time, the bot posts one short message **before** the signup embed — no embed of its own: when the Run's `discordRolePing` flag is on, the Guild roles `tank` / `healer` / `dps` are pinged on the first line; then one line `<:PhoenixStarDiscord:…> Raidboost: **HC** 💎 VIP · Venom & Tide & Kithix — signups open below <:PhoenixStarDiscord:…>` (Guild emoji name `PhoenixStarDiscord`, omitted when missing). Title, time and roster live in the Signup embed right below, so the channel never stacks two information-heavy embeds. Existing channels are never re-announced (no backfill / no re-ping on later polls). A channel recreated for a Run whose signup post already went out once (`signupPostedAt` set) gets its signup embed again but **no** second announce or role ping (`announceOnCreate: false`). Continuity edits for CANCELLED/COMPLETED Runs never provision a replacement channel. Missing emoji or roles are skipped with a warning; the announce still posts.

**Legacy/test fallback**: when `DISCORD_RUN_CATEGORY_ID` is unset, the bot posts into the single global `DISCORD_SIGNUP_CHANNEL_ID` / `DISCORD_ROSTER_CHANNEL_ID` exactly as before per-Run provisioning existed — useful for a minimal test setup that hasn't created a category yet. At least one of the two configurations is required at startup (`loadBotEnv` fails fast otherwise). `channels` reconciliation only ever concerns `RunDiscordPost.runChannelId` — the legacy global channel ids are never treated as a dedicated Run channel and never appear in `channels`.

**Permissions**: creating, renaming, moving, and repositioning channels requires the bot's role to have **Manage Channels**, in addition to View Channels / Send Messages / Embed Links / Read Message History (full list in [OPERATIONS.md](OPERATIONS.md#discord-bot-permissions)). The created channel inherits permissions from its parent category by default — no per-channel permission overwrites are created, and a category move never resyncs permissions (`lockPermissions: false` — see "Channel reconciliation").

#### Channel reconciliation

**Channel state is reconciled independently from message state**, so a Run with a settled signup and roster message still gets its channel name, category and week section corrected.

`discordSyncService.listSyncWork()`'s `channels` lane returns one `ChannelSyncWorkItem` — `{ runId, existingRunChannelId, desiredChannelName, targetBucket, scheduledStartAt }`, with `existingRunChannelId` always non-null — for **every** Run that already has a persisted `RunDiscordPost.runChannelId`, regardless of `Run.status` (DRAFT included, for an abnormal legacy row), archive state, raid-ID week, or whether any signup/roster message currently needs updating. It is expected and correct for this lane to return the same Run on every poll — BoostingHub's database knows the *desired* name/category/ordering but not Discord's *live* `parentId`, position, or actual channel name (including any out-of-band manual change), so the bot must keep re-checking. This is also what makes automatic weekly rollover (NEXT → CURRENT) work with zero database writes — see "Weekly raid-ID sections" below.

Two independent mechanisms act on `channels`, both in `src/discord-bot/channel-reconciliation.ts`, deliberately decoupled from discord.js's concrete channel types so they're unit-testable without a live bot token (`channel-reconciliation.test.ts`):

**1. `reconcileExistingRunChannel`/`reconcileChannels`** — name and parent category, one channel at a time:

1. Fetch the channel by its persisted id (`sync-loop.ts`'s adapter prefers `client.channels.cache` over a `fetch` REST call).
2. If it can't be resolved (deleted or inaccessible): log a warning and skip — never crash, never provision a replacement (that stays exclusive to the signup path above), and never let one bad channel stop the rest of the batch from reconciling.
3. If its name doesn't match `desiredChannelName`: `setName(...)` in place.
4. Independently, resolve the desired parent from `item.targetBucket` — `"CURRENT"` and `"NEXT"` both → the ONE `DISCORD_RUN_CATEGORY_ID`; `"ARCHIVE"` → `DISCORD_RUN_ARCHIVE_CATEGORY_ID`. The bot never computes `targetBucket` itself — it always arrives already decided by `discordSyncService` (see "Weekly raid-ID sections"). If the resolved category env var is unset: log a warning and leave the channel where it is. If its current `parentId` already matches: no-op. Otherwise `setParent(desiredParentId, { lockPermissions: false })` — a plain move, never a permission resync, never a delete/recreate/clone.

**2. `reconcileWeekSectionPositions`** — CURRENT/NEXT ordering *within* the one active category, computed once per poll across every CURRENT/NEXT `channels` item together (position is inherently a multi-channel concern, unlike name/parent):

1. List the active category's current children (id + live `position`) and locate the two marker channels (`DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID`) among them. Missing either marker, the category itself not resolving, or the markers being out of order (`#next-id` above `#current-id`) all warn and skip this poll's position reconciliation entirely — never inventing a replacement anchor, never silently swapping the markers.
2. Sort each section by time: CURRENT (between the markers) and NEXT (after `#next-id`) each contain BoostingHub's Run channels (time from `scheduledStartAt`) **and** any manually created Run channels already in that section whose name starts with `{weekday}-{HHMM}` (e.g. `fri-1300-…`), interleaved by minute of the raid week (Wednesday 06:00 Europe/Berlin first; ties: BoostingHub first). Unmanaged channels without a recognisable time keep their relative order at the end of their section; channels above `#current-id` are untouched, and nothing is moved between sections.
3. Build the full desired top-to-bottom order — `[unmanaged before] #current-id [CURRENT section by time] [CURRENT untimed] #next-id [NEXT section by time] [NEXT untimed]` — and compare it against the category's actual current order. Already matching: zero API calls.
4. Otherwise, submit the ENTIRE category's channels as one dense `setPositions([...])` call (discord.js's `guild.channels.setPositions`), including the two markers. This is a confirmed requirement of Discord's real API — a sparse payload naming only the channels that need to move, leaving the rest (including the markers) unspecified, is silently ignored rather than applied; see the code comment on `reconcileWeekSectionPositions` for how this was discovered against a live server.

Steps 3–4 of the first mechanism, and the whole of the second, are each independently idempotent. `sync-loop.ts` runs channel reconciliation (name + parent) first, then any signup/roster message work (which may provision a first channel), then **one** CURRENT/NEXT position reconciliation that includes both pre-existing `channels` items and any channels created in this same pass — so a brand-new CURRENT/NEXT Run channel finishes its first successful sync already in the correct marker section. Position reconciliation runs in a `finally` after provisioning is known, so a later signup/roster embed send/edit failure cannot leave a newly created channel below `#next-id` until the next poll.

**Position settle consistency model** (`reconcileWeekSectionPositionsUntilSettled`):

| Situation | REST `guild.channels.fetch()` (`GET /guilds/:id/channels`) |
| --- | --- |
| Planning snapshot already in correct relative order (`moved === 0`) | **Skipped** — trust gateway/cache; avoids burning Discord's low budget for that route on every 5s poll |
| After a real `setPositions` write | **Always** fresh-verify; if live order still wrong (create→position lag), retry reconcile+verify up to two more times with a short bounded delay (not the next poll) |
| Bounded out-of-band refresh | At most once per five minutes (`WEEK_SECTION_OUT_OF_BAND_REFRESH_MS`), even on write-free passes, so rare manual Discord reorders that missed the cache still self-heal without a per-poll full-guild list |

Later polls still self-heal weekly NEXT → CURRENT rollover via the same reconciler (cache/gateway shows wrong order → write → fresh verify). A `runId -> channelId` map from the name/parent pass lets the message paths reuse the same resolved channel instead of re-resolving (and potentially re-renaming/re-moving) it a second time in the same poll.

**Archive / completion / cancel**:
- **Terminal status** (COMPLETED / CANCELLED): closes the Run operationally; Discord channel gets closed naming but stays until app archive.
- **Explicit app archive** (`Run.archivedAt`): sole destructive TEXT-channel retirement authority (`retireChannel: true` only when archived, and no PENDING lifecycle announcements).
- **Schedule ARCHIVE category** (PAST/FUTURE): non-destructive holding — move only, `retireChannel: false`.
- **Voice channels**: independent temporary lifecycle (RETIRE_IF_EMPTY on COMPLETED/CANCELLED/archived) — not gated by app archive.

`retireChannel` is true only when `Run.archivedAt` is set **and** there are no `PENDING` `RunDiscordAnnouncement` rows for that Run. Lifecycle channel announcements (reschedule / cancel / reactivate) still post on the existing channel; Cancel→Reactivate normally keeps the same channel without replacement. While a cancel (or earlier reschedule) announcement is still `PENDING`, retirement is blocked (`retireChannel: false`, `pendingLifecycleAnnouncements: true`). Immediately before Discord send, the bot re-checks deliverability (`GET .../delivery-authority`) so stale in-memory CANCELLED work cannot post after Reactivate; recording `SENT` is compare-and-set on `PENDING` only. Transient Discord send failures leave the announcement `PENDING` and keep the channel. Missing channel / Missing Access → terminal `FAILED_PERMANENT` or `SKIPPED` for cancel/reschedule; `RUN_REACTIVATED` with no channel yet stays `PENDING` for continuity recovery (legacy channel-loss cases). Immediately before every irreversible channel.delete(), the bot re-checks current retirement authority via `GET /api/bot/runs/:runId/discord-retirement` — only the live row's `archivedAt != null` may return `{ retire: true }`. Restore Archive clears `archivedAt` and immediately revokes delete authority. The next sync pass after announcements are terminal and the Run is app-archived:
1. Renames the dedicated channel to `closed-{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}` via `buildClosedDiscordRunChannelName` (in place — **never** moved into `DISCORD_RUN_ARCHIVE_CATEGORY_ID` for retirement; schedule holding may already have moved PAST/FUTURE channels into that category without deleting them).
2. Posts Ticket-Tool-style archive artifacts **once** into `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID` (e.g. `#raid-open-channel-logs`):
   - Message 1: `<Server-Info>` xml code block + `transcript-{channelName}.html` attachment. Every message keeps author, time, id (and edit time); its text slot is the escaped text, or honestly `(message content unavailable)` when Discord withheld it (no Message Content access — the bot's own posts and messages mentioning it are still delivered), `(system message)` / `(no text)` only when the message really had none. Attachments (name + size, never downloaded) and stickers are listed. A notice at the top and `Message Content: AVAILABLE|PARTIAL|UNAVAILABLE|UNKNOWN` (header line + `<meta name="manawyrm-message-content">`) state how complete the text is. All interpolated values are HTML-escaped. Missing access never blocks archival.
   - Message 2: green details embed (Ticket Owner / Ticket Name / Panel Name / Users in transcript) + **Direct Link** button to the attachment
   - Persists the same HTML on `RunDiscordPost` for manager download at `/runs/[runId]/archive-transcript`
   Idempotency: `archiveArtifactsNeeded` until Discord message ids **and** `archiveTranscriptHtml` are recorded. When ids already exist but HTML is missing (legacy rows), the bot rebuilds HTML from the Run channel and records it without re-posting to Discord. When the log channel env is unset, Discord posts are skipped with a warning and the Run channel is left alone until artifacts can be written. If the details embed fails after the transcript attachment was posted, transcript message id + HTML are still recorded (durable archive authority) and deletion may proceed once `archivedAt` remains set.
3. **Deletes** the Run's Discord TEXT channel (only after successful archive preservation + fresh `archivedAt` check) and records `channel-gone` for that exact channel id — the Manawyrm Hub Run remains as an archived Run; only the Discord channel is removed. Leftover channels from older deploys are deleted on a later poll once artifacts are already complete and the Run is still archived.

**Retired channel identity.** Once a retiring Run channel is confirmed gone, the bot reports `channel-gone {channelId}` — never `clear-channel`:

| Outcome while retiring | State update |
| --- | --- |
| Channel deleted by the bot | `channel-gone` (exact id) |
| Discord says Unknown Channel (delete, or transcript fetch) | `channel-gone` (exact id) |
| Missing Access / Missing Permissions | none — identity kept, retried next pass (the channel may still exist) |
| Channel exists but is not a usable/deletable text channel | none — identity kept, logged |
| Other Discord/API error | none — identity kept, retried next pass |

`channel-gone` runs `clearDeletedChannelIdentity(runId, channelId)`: one compare-and-set UPDATE per group, each requiring the stored id to still equal `channelId` — Run channel; signup channel + message + signature; roster channel + message + version. So it clears everything the deleted channel held (otherwise the Run's signup identity would keep it a zero-work sync candidate forever), never a replacement channel recorded meanwhile, and never a signup post living in a different (shared/legacy) channel. Final Setup markers, Voice identity, archive transcript and Raid Invite history are kept. `clear-channel` (drops only `runChannelId`, unguarded) is no longer used for retirement.

##### Run channel lifecycle announcements

Durable `RunDiscordAnnouncement` rows (`RUN_RESCHEDULED` / `RUN_CANCELLED` / `RUN_SCOPE_CHANGED`) are created by `runService` on successful schedule change / cancel / material raid-scope change (`RUN_SCOPE_CHANGED` is written in the same transaction as the new `RunRaidContent` rows and posts "⚠️ Run Updated" with only the changed contents; the regular signup/roster embeds still refresh in place via their signatures) — never by calling Discord from the web process. The bot's existing sync poll includes a bounded `runAnnouncements` lane (createdAt ASC). Posts use embeds with Discord native timestamps (`<t:…:F>`); no `@everyone` / role / member pings. No channel is provisioned solely for a lifecycle message. User DM preferences never gate these channel posts.

PAST/FUTURE schedule holding still uses the ARCHIVE category as a **silent move only** — live schedule-based name, no `closed-` rename, no log posts, no delete (`retireChannel: false`).

**Restore**: `runService.restoreRun` clears `archivedAt` and clears archive-artifact message ids so a later re-archive can post again. Restore immediately revokes TEXT-channel delete authority (fresh `discord-retirement` check returns false). If the channel was already deleted under a prior archive, restore does not resurrect it — a later CURRENT/NEXT signup window may provision a fresh channel via the normal signup path / continuity recovery. Restore never invents Discord infrastructure on its own.

Neither Archive nor Restore creates signup/roster message work by itself — retirement with no other Run change produces the one-time transcript post + channel delete only when `archivedAt` is set.

#### Weekly raid-ID sections

The Discord server keeps ONE active Run category (e.g. "Weekly Raid Schedule") with two manually-managed marker text channels inside it — `#current-id` and `#next-id` — that visually divide it into a **CURRENT** raid-ID week section and a **NEXT** one. Discord channels cannot contain child channels, so CURRENT and NEXT are not, and cannot be, separate categories; they are ordered blocks of Run channels sitting above/below the two markers within the one category:

```text
Weekly Raid Schedule              <- the ONE active category (DISCORD_RUN_CATEGORY_ID)
  #current-id                     <- marker channel (DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID)
  sun-1800-hc-vip-8of8-...        <- CURRENT Run channels, chronological
  mon-1800-hc-vip-8of8-...
  #next-id                        <- marker channel (DISCORD_RUN_NEXT_MARKER_CHANNEL_ID)
  sun-1900-hc-vip-5of8-...        <- NEXT Run channels, chronological
  mon-1900-hc-unsaved-8of8-...
```

BoostingHub places each Run's dedicated channel according to its `scheduledStartAt`, re-evaluated on every sync pass — there is no persisted week bucket or channel position anywhere in the schema, and no cron mutates a Run row for weekly rollover.

**Marker channels are manual Discord infrastructure, not BoostingHub-owned channels.** They are ordinary text channels a human creates and places inside the active category; BoostingHub never creates, renames, deletes, archives, or reparents them. Their ids are pure environment configuration (`DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID`), exactly like a configured category id. Their live `position` **may** shift as a side effect of the section-ordering payload described below (e.g. `#next-id` moves down whenever the CURRENT section gains a channel) — this is a mechanical consequence of how Discord's position API works, not BoostingHub taking editorial control of the markers: their id, name, and parent are never touched, and their relative order to each other (`#current-id` above `#next-id`) is asserted up front and never itself changed.

**Persistent Schedule posts.** Each marker channel is also the home for exactly one canonical Schedule message:

- `#current-id` → **📅 Current Raid ID — Schedule** — active CURRENT-week Runs only
- `#next-id` → **📅 Next Raid ID — Schedule** — active NEXT-week Runs only

The Schedule is an operational read model, not history. Included statuses: `OPEN`, `ROSTERING`, `PUBLISHED`, `IN_PROGRESS` with `archivedAt` null. Excluded immediately: `DRAFT`, `COMPLETED`, `CANCELLED`, application-archived Runs (`archivedAt != null`), plus week buckets `PAST` and `FUTURE` beyond NEXT. Completed, Cancelled, and app-archived Runs disappear from the Schedule on the next sync even while their Run channel still exists for final WCL scan / transcript / archive — archival and transcript history remain the history authority. Rows sort by `scheduledStartAt` ASC with stable `runId` tie-break. A Run without a dedicated channel yet still appears (no `<#channel>` mention). Reschedules reorder within a bucket or move CURRENT ↔ NEXT; leaving both buckets removes the Run from both messages.

Identity lives in `DiscordSchedulePost` (one row per bucket: `channelId`, `messageId`, `lastSignature`) — never in `RunDiscordPost`. The server builds the desired embed + deterministic signature (`SCHEDULE_MESSAGE_FORMAT_VERSION` + bucket + per-Run fields); the bot creates or edits the same Discord message in place. Even when the signature is unchanged, the bot still verifies the stored message id still exists (direct fetch, no channel scan). Confirmed Discord Unknown Message (`10008`) creates exactly one replacement; Missing Access / Missing Permissions / network / timeouts keep the stored identity and retry next poll — they never spawn a duplicate. If the configured marker channel id changes, the bot posts the canonical Schedule into the new marker immediately and best-effort deletes the exact previous stored message afterward. Empty weeks edit the same message to `No active Runs scheduled.` — the message is never deleted. Schedule sync is an independent lane: its failures never block signup, roster, voice, WCL, or archive work, and it never waits on archival. Realistic weekly volume fits one embed description (Discord 4096-char limit); there is no multi-message paginator.

**Boundary**: Wednesday 06:00 **Europe/Berlin** — a local wall-clock instant, not a fixed UTC offset. Europe/Berlin alternates between CET (UTC+1) and CEST (UTC+2); the reset stays 06:00 local across that transition, which is why `classifyRunWeek()` (`src/lib/wow-run-week.ts`) recomputes the boundary from real calendar dates via timezone-aware arithmetic on every call rather than adding `7 * 24h` in milliseconds to the previous boundary — the latter would silently drift the local reset time by an hour across a DST transition. This is a **product-specific** boundary, unrelated to `wow-weekly-reset.ts`'s fixed-UTC Blizzard regional reset (used only for lockout/encounter classification) — the two are never derived from each other.

**Half-open windows**, given `currentStart` = the most recent Wednesday 06:00 Europe/Berlin at or before `now`, `nextStart` = 7 local calendar days later, `followingStart` = 7 more:

| Bucket | Range |
| --- | --- |
| PAST | `scheduledStartAt < currentStart` |
| CURRENT | `currentStart <= scheduledStartAt < nextStart` |
| NEXT | `nextStart <= scheduledStartAt < followingStart` |
| FUTURE | `scheduledStartAt >= followingStart` |

**App archival always wins.** `resolveDiscordTarget` (`discord-sync.service.ts`) checks `Run.archivedAt` first — an archived Run always targets ARCHIVE (a real, separate category) regardless of what its schedule would otherwise classify. Only when a Run is *not* app-archived does its raid-ID week decide the target: CURRENT/NEXT map to the CURRENT/NEXT sections of the one active category; **PAST and FUTURE both map to ARCHIVE** as a holding placement — this keeps the strict invariant that the CURRENT section contains only CURRENT-week Runs and the NEXT section contains only NEXT-week Runs, without ever deleting/recreating an already-provisioned channel that has simply aged out of the active rotation (PAST) or hasn't reached it yet (FUTURE, legacy data only — see below). This never touches `Run.archivedAt`; a PAST/FUTURE Run sitting in ARCHIVE holding is not "app-archived" and stays fully editable/manageable exactly as any other non-archived Run of its status.

**Far-future first-channel suppression**: a Run classified FUTURE with no existing `runChannelId` never gets one — not a channel, not a `RunDiscordPost` row, not a signup message — even while `OPEN` with `signupsOpen: true`. First-channel provisioning requires **both** `isSignupWindowOpen` **and** a CURRENT/NEXT classification (see "Per-Run Discord channel" above); FUTURE and PAST both fail that second condition. A Run scheduled two raid-ID weeks out today produces zero Discord side effects until the calendar catches up.

**Automatic rollover, no database write**: because `channels` reconciliation re-derives `targetBucket` from `scheduledStartAt` + real time on *every* poll, a Run that was NEXT yesterday and becomes CURRENT after this week's Wednesday 06:00 rollover is picked up by the very next sync pass. Unlike Archive/Restore, this specific transition is **not** a parent-category move — CURRENT and NEXT already share the same parent — it is a *position* change, computed by `reconcileWeekSectionPositions`: the channel moves from below `#next-id` to between `#current-id` and `#next-id`, same channel id, same category. No cron, no scheduled job, no Run row update. The same mechanism handles a Run that was legacy-provisioned while FUTURE (pre-dating this feature, or created before its week became eligible) sitting in ARCHIVE holding: once real time advances it into NEXT and then CURRENT, the same channel id moves ARCHIVE → (active category, NEXT section) → (active category, CURRENT section) across successive weekly rollovers, never deleted or recreated.

**Environment variables**:

- `DISCORD_RUN_CATEGORY_ID` — the ONE active Run category. CURRENT and NEXT both resolve to it.
- `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID` / `DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` — the two marker channels. Required for CURRENT/NEXT position reconciliation and for the persistent Schedule posts; if either is unset, that reconciliation / Schedule bucket is skipped with a warning each poll (channels still get the correct category and name, just not corrected ordering / Schedule).
- `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — the holding place for PAST / FUTURE channels and for app-archived Runs.

`loadBotEnv` (`src/discord-bot/env.ts`) still only hard-fails at startup when *no* channel destination exists at all (no `DISCORD_RUN_CATEGORY_ID` and no legacy `DISCORD_SIGNUP_CHANNEL_ID`); missing markers or a missing ARCHIVE category are per-poll warnings at reconciliation time, never a startup failure.

**Unmanaged channels**: a channel that's neither a configured marker nor a persisted `RunDiscordPost.runChannelId` is never renamed, deleted, or reparented, and never leaves the zone (before `#current-id`, between the markers, after `#next-id`) it already sits in. Within the CURRENT and NEXT sections, a manually created Run channel named `{weekday}-{HHMM}-…` is **repositioned by time** together with BoostingHub's own Run channels, so the whole section reads chronologically; any other unmanaged channel keeps its relative order at the end of its section, and channels above `#current-id` are never moved. Because Discord's position API requires submitting the category's full channel list at once (see "Channel reconciliation"), unmanaged channel ids appear in that one batched call whenever anything in the category needs reordering. **Voice / stage channels** in the Run category (the fixed `Raid #1` / `Raid #2`) are left out entirely: Discord sorts them in their own group below the text channels, so the bot never lists, compares or repositions them.

#### Signup embed

Posted into the Run's dedicated channel (or the legacy global signup channel — see Per-Run Discord channel above) once a Run is actually signup-available. Roster-first layout: the **title** is the compact content title from the Raids' short names (`Raid.shortName`, editable in the Raid Catalog; empty = derived from the name), e.g. `Venom & Tide & Kithix`, linking to the Run. Right under it a **3×2 header grid** of inline fields aligned with the role columns: `⚔ Raid Lead` (plain name — field names cannot render mentions) | run type only (`💎 VIP`; VIP uses the Guild `:Unsaved:` emoji when present) | `👥 N signed` (distinct signed-up Users — the old "Signed users"), over date | time | relative start (Discord timestamps). The description is empty for an open Run and only says "Signups are closed." / "Run ended" when relevant — no Scheduled / Signed users / Status block. Then **Tanks | Healers | DPS** inline fields (one row on desktop, stacked on mobile; headings carry the signup count only (`Healers 5`, Users offering that role — never `/target`; selection progress and targets live on the Roster message); DPS groups Melee and Ranged visually only), **Lootbuddies**, **📝 Notes** (only when a signed-up User left one) and **🔗 Open Run**. Each entry is class emoji + mention. Role headings use Guild custom emojis named `tank` / `healer` (or `heal`) / `dps` / `loot` / `raidlead` when present (unicode fallback otherwise). Class emojis use the class name (`warrior`, `mage`, …, `dk`, `dh`), matched case-insensitively, from one shared per-Guild snapshot cached for **10 minutes** (`class-emoji-lookup.ts`). Discord limits: when the embed would exceed 6000 characters / 25 fields / 1024 per field, class icons are dropped first (mentions stay), then note lines are shortened — roster names are never dropped.

Buttons, two rows: **📝 Signup** · **⚡ Quick Sign** · **💰 LB** (all Success / green; LB uses the Guild lootbuddy emoji when present), then **Unsign** (Danger) · **🗒️ Add / Edit Note** (Primary / blurple). Once the Run has ended the message shows one **🗄️ Archive Run** button instead: after an ephemeral confirmation it calls `POST /api/bot/runs/:runId/archive` as the acting Discord User, with the same rules as the app (Raid Lead of the Run or Admin, COMPLETED / CANCELLED only). The signup row disables once the signup window closes; Unsign and the note stay enabled. **Add / Edit Note** opens a modal prefilled with the User's note (one short line, ≤ 100 characters; empty removes it). The note is stored on every non-withdrawn signup of that User for the Run (`RunSignup.notes`, `PUT /api/bot/runs/:runId/signup/note`) — no Discord-only copy — and needs an active signup. The character multi-select shows class icon, `Character-Realm`, and `role · offspec` (+ informational lockouts) per option. Custom ids (`src/discord-bot/custom-ids.ts`) carry `action:runId` (never a User id) for the buttons and the character multi-select, and a character-scoped `action:runId:characterId` form for the per-Character role selects described below — every id is validated against the same shape the server accepts before any network call is made.

##### Signup / Quick Signup / Lootbuddy button flow

**Signup (Booster)** — Character multi-select + **Next** → staged role editor → Confirm:

1. `interaction.deferReply({ ephemeral: true })`.
2. `GET .../signup-options` for the acting Discord User.
3. If the window is closed or there are no eligible Booster Characters, say so and stop.
4. Start a BOOSTER staging session (seeded from `activeBoosterOffers`) and show Character multi-select with **Next** / **Cancel**. Closing the select dropdown only updates the staged picks in memory and refreshes the same menu — it does not change the step or list selections in the message. **Next** is the only advance into roles.
5. **Next** opens the role editor: per-Character **offered-role** multi-selects (`minValues=1`; single-role classes show a fixed label), Confirm / Cancel. Confirm calls `setCharacterOffers` once with `{ characterId, offeredRoles[] }`; Cancel discards staging only.
6. Staging is in-memory (`signup-staging.ts`), TTL ~15 minutes, wiped on bot restart without touching DB.

**Quick Signup (Booster)** — one click, no Character selector, no staging session:

1. `interaction.deferReply({ ephemeral: true })`.
2. `POST .../signup/quick` for the acting Discord User (`signupService.quickSignupBoosters`).
3. Concise ephemeral feedback: `Signed up with N characters offered.` plus, when relevant, skip reasons (`unavailable` / `scheduling conflict` / `missing default role` / `inactive`). Saved progress is never a skip reason; a non-conflicting reservation is not either.
4. `requestImmediateSync()` so the public Signups embed refreshes through the normal sync lane.

Quick Signup offers all eligible Booster characters (same `evaluateBoosterOptions` authority as manual signup). Saved characters and characters used on non-conflicting runs are included. Characters marked unavailable or reserved for a conflicting run (&lt; 2h) are skipped. Additive (preserves existing `offeredRoles` and selected/draft-selected rows), Booster-only, and never touches Lootbuddies. Web does not expose this accelerator.

Public signup embed Roles field:

- **Signups by role** = the unpicked pool (`isAvailableSignup`: PENDING or NOT_SELECTED) by offered role, minus current roster picks and minus **every BOOSTER offer of a User who holds a BOOSTER pick** (a User has at most one booster slot, so a repick A → B never makes them reappear) — hybrids count once per offered role. LOOTBUDDY rows stay decided per signup row. The Web roster keeps listing all of the User's valid signups, so a Raid Lead repicks A → B in one save (the builder replaces the User's previous booster pick). A pick leaves the pool as soon as it is a pick: a saved draft selection before publication (status still PENDING), a SELECTED signup after; it returns when unpicked (draft removal, or SELECTED → NOT_SELECTED on Update Roster). A replacement draft after publication stays private until Update Roster. Roster publication must not hide unpicked (`NOT_SELECTED`) signups (#230).
- **Signed users** = distinct Users with any non-withdrawn signup (`isSignedUpSignup`: PENDING, SELECTED, NOT_SELECTED) — picks still count. Role-list membership is part of the signup signature, so picks/unpicks edit the existing message in place.
- Selected lineup is **not** rendered on this message — it lives on the separate **Roster** Discord message (`rosterMessageId`).
- External boosters never appear on the Signup embed.
- Lootbuddy signup column is a volunteered count only (planned Lootbuddy target lives on Roster).
- Participant lines: Discord `<@id>` mention once per User, then distinct class emoji(s) for that User's offers in the column (no Character-Realm, no repeated mentions). Mentions show the server nickname when set; Character identity is in Final Setup and the Web app.
- Footer clarifies: signup does not mean selected.

**LB (Lootbuddy)** — two steps (no Character selector, no Mode picker on Discord):

1. Click **LB** → ephemeral **multi** class select (1–13 classes).
2. Confirm the selection → immediately `PUT .../lootbuddies` with one `LOOT_ONLY` entry per chosen class (replaces any previous Discord lootbuddy set for that User on the Run).

Mode (`Loot only` / `Play along`) and multi-entry lootbuddy sets remain available on the Web. Stale multi-step wizard buttons from older bot messages tell the User to click **LB** again.

##### Unsign button

`POST .../signup/cancel` (optional body `{ reason }`) — withdraws the User's active **BOOSTER and LOOTBUDDY** participation (`withdrawFromRun`). Lootbuddy-only Users can leave via this same button.

A **picked** User (on the roster or its saved draft) must give a reason: without one the API answers `WITHDRAW_REASON_REQUIRED` and writes nothing, and the button opens a **modal** (`boostinghub:withdraw-reason:<runId>`, one paragraph field, 3–300 chars). The button therefore replies without deferring (a modal must be the first response). The modal submit withdraws with the reason; the Raid Lead gets a `ROSTER_WITHDRAWN` DM (**Roster Withdrawal**: player, character, reason — escaped so it cannot mention anyone — and a link to the Roster tab built from `BETTER_AUTH_URL`). After Start Run a picked User cannot withdraw.

#### Roster embed

Posted into the **same Run channel** as the signup embed (or the legacy global roster channel) as a **second Discord message** (`rosterMessageId`), independent of the Signup message. Selected Characters / external boosters only — never the volunteered signup pool. Title is `Roster`; Final Setup (`startMessageId`) remains a separate plain-text operational post after Start.

The lane maintains exactly one Roster message once the Signup message has been
provisioned (also when draft picks / externals / a prior Roster id already
exist). An empty selected lineup still posts/keeps the empty-state Roster embed
(`No players selected yet.`). **Publish Roster** transitions Draft → Published
on that **same** `rosterMessageId` in place — it never appends a second Roster
message. Save / Update / emoji / presentation refreshes also edit the current id.

**Post vs refresh.** The roster lane decides per Run:

| Condition | Mode | Bot action |
| --- | --- | --- |
| `RunRoster.postRevision > (RunDiscordPost.lastRosterPostRevision ?? 0)` | `POST` (carries `postRevision`) | edits the current `rosterMessageId` in place when it exists (or sends exactly one if missing / Discord-deleted), and records `{ kind: "roster", messageId, postRevision }` so `lastRosterPostRevision` acknowledges the fulfilled revision — **same message id** when the message already existed |
| otherwise, no message yet, `lastRosterVersion !== RunRoster.version`, or the bot's Roster render fingerprint (`ROSTER_EMBED_FORMAT_VERSION` + Guild class/role emoji fingerprint) differs from `lastRosterEmojiFingerprint` (null / pre-format posts refresh once) | `REFRESH` | edits the current `rosterMessageId` in place (Save / Update Roster, External Boosters, Raid Lead title change, new or renamed Guild emojis, presentation-format bumps); if that message was deleted in Discord it is re-sent as recovery, without claiming a post revision |

`postRevision` is advanced only by the first Publish and by an explicit **Publish Roster** republish (compare-and-set, see [Publication](#publication)); Save and Update never advance it. There is no historical stack of Roster messages — one live Roster embed per provisioned Run channel (Final Setup after Start is separate).

**Legacy rows.** Rosters published before postRevision existed have `postRevision = 0` and `lastRosterPostRevision = null` (treated as 0): no POST is pending, so their existing message is only refreshed. The next explicit Publish Roster requests revision 1 and edits that same message.

**Delivery.** Recording is idempotent per revision: after the bot records revision N, later polls see no pending POST, and a double-submitted republish request can only advance the revision once. If the bot crashes after Discord accepted an edit/send but before the web app recorded it, the next pass retries (at-least-once for that window) without creating a duplicate when the stored message still edits successfully.

Groups: Tanks, Healers, DPS, and Lootbuddies (omitted when empty). DPS is **one group**, like the Run's single `desiredDpsCount`: `DPS (selected/target)`, listing melee, then ranged, then DPS whose subtype is unspecified (melee/ranged still comes from `attackTypeForSpecialization`, `src/lib/wow-specializations.ts`, and orders the list; the class emoji shows the class). A long DPS list continues in `DPS (cont.)` fields via `chunkEmbedFieldLines`, never cut and never over Discord's 1024-character field limit. `ROSTER_EMBED_FORMAT_VERSION` `v5-one-dps-group` makes existing Roster messages re-render once.

Each member renders as `<@discordUserId> <:class:> — Character-Realm` when the User has a linked Discord account (class emoji from Guild custom emojis, else the class label), or `<:class:> — Character-Realm` when unlinked. Role column headers use the same Guild role emojis as the signup embed (`tank` / `healer` / `dps` / `loot`), with the same unicode fallbacks (🛡 ✚ ⚔ 📦).

#### Raid Invite DMs (Apex-style)

When a Run is **started** (`Start Run` → `IN_PROGRESS`), BoostingHub creates a `RAID_INVITE` `UserNotification` for each SELECTED participant. Publishing the roster earlier does **not** send invites. Discord DM intent is snapshotted from `User.dmRaidInviteEnabled` + linked Discord id at creation.

The bot delivers from `listSyncWork.notificationDms` (PENDING rows only). The legacy `raidInvites` sync lane was removed (audit A19) — do not regenerate invites from SELECTED + `raidInviteSentSignupIds` (avoids double DMs). SENT RAID_INVITE DMs still append `raidInviteSentSignupIds` via `recordNotificationDmDelivery`. See [User settings and notifications](#user-settings-and-notifications).

```text
📣 **Raid Invite**

{contentTitle}
<t:…:F> · {DIFFICULTY} · {Run type}

Assignment: {Role} · {Character} ({Class})
Channel: <#runChannelId>
Voice: <#voiceChannelId>

Please be online 10 minutes before start.

[Open Run](<Run URL>)
```

- VIP appears once — on the meta line (the Run type); the Assignment line does not repeat it.
- `Channel:` uses the persisted `RunDiscordPost.runChannelId` as a real `<#id>` mention. When that id is missing, the Channel line is omitted — never `#unknown`.
- `Voice:` links the Run's temporary voice channel (see below). The bot prefers the voice channel it created or deleted **in the same sync pass** (voice runs before DMs), else `RunDiscordPost.voiceChannelId` read when the DM is due — so a Quiet-Hours-delayed invite never links a channel that was already deleted. Omitted when there is none. The mention is rendered by the bot only; `UserNotification.message` never contains it.
- Permanent DM failures (`isDiscordPermanentDmError`: closed DMs 50007, no mutual guilds 50278, Missing Access 50001 / Missing Permissions 50013) → `FAILED_PERMANENT` (no retry, one compact warn line with notification id and Discord code). Rate limits, 5xx, network/timeouts and unknown codes leave `PENDING` and retry on the next pass.
- Successful RAID_INVITE DMs also append `RunDiscordPost.raidInviteSentSignupIds` for legacy continuity.
- Users must share the guild with the bot and allow DMs from server members.
- App-archived Runs do not enqueue notification DMs.

Roster Pick DMs (`ROSTER_SELECTED`) use a separate message body (`buildRosterSelectedDmMessage`) and are also delivered via `notificationDms`.

##### Run DM format (every Run-related DM)

All Run DMs — Roster Selected / Roster Update (swap) / Roster removed / Roster Withdrawal (Raid Lead) / Raid Invite / Run Cancelled / Run Reactivated / Run Updated (scope) / Run Rescheduled / the three Saved DMs — share one hierarchy (`src/lib/discord-run-dm.ts`: `DmRunContext`, `dmRunHeader`, `dmRunUrl`):

```text
{emoji} **{Event heading}**

{contentTitle}                      ← e.g. Venom & Tide & Kithix
<t:…:F> · {DIFFICULTY} · {Run type}

{event-specific lines}

{action link}                      ← last line: [Open Run](<url>) / [Open Roster](<url>) / …
```

- **Run identity** is the compact content title from `contentShortTitle` (`Raid.shortName` in authoritative content order: `Venom`, `Venom & Tide`, `Venom & Tide & Kithix`) — the same identity as the Signup post and the lifecycle channel announcements. It is derived once per DM work item from the persisted Run contents (`NotificationDmWorkItem.contentTitle`); `productLabel` ("Season 2 Bundle", formal Raid names) stays for its other consumers and is only the fallback for an older API.
- **Run Rescheduled** shows `Old:` / `New:` in place of the meta line.
- **Action links** are masked Markdown links with the URL in angle brackets (`dmLink`: `[Open Run](<https://…>)`): Discord shows only the label (no wrapped raw URL) and attaches no website preview card (verified live: `embeds = 0`). Labels: **Open Run** (Roster Selected / Update / removed, Raid Invite, Cancelled, Reactivated, Rescheduled, Saved player, Start Run reminder), **Open Roster** (Saved Raid Lead, Start Run summary), **Pick a replacement** (Withdrawal), **Review updated Run** (scope change). Open Roster targets the Roster tab, which is the Run Detail default (`/runs/<id>`).
- The Start Run Saved summary DM delivers the bell notification's own text (`savedSummary.message`) under the heading — the affected-set snapshot; delivery never parses notification copy.
- Event semantics (recipients, triggers, per-event toggles, Quiet Hours, idempotency) are unchanged by the format.

#### Run voice channels

**Attendance voice hint.** While a Run is IN_PROGRESS the bot reports, at most once a minute (`VOICE_PRESENCE_REPORT_INTERVAL_MS`), the Discord user ids connected to its assigned voice channel (gateway voice-state cache from the existing `GuildVoiceStates` intent — no extra Discord request, bots excluded; an unreadable channel, or one with more than 100 distinct members, is not reported — never a truncated list) to `POST /api/bot/discord/voice-presence`. The web accepts a report only for an IN_PROGRESS, non-archived Run whose current `RunDiscordPost.voiceChannelId` is the reported channel, and keeps it **in memory only** with a 3-minute TTL (`voice-presence.service`) — no table, no history. The Attendance tab shows *In voice* / *Not in voice* / *Voice unknown* per participant (matched by `User.discordUserId`); no fresh report, another channel, a stale report, a bot or web restart, or an unlinked account all read as unknown. It is a hint only: it never sets or suggests an attendance status. One `next start` process is assumed; more instances would see only their own reports (unknown, never a wrong *In voice*).

When a Run is `IN_PROGRESS` (after Start Run, with a start snapshot), it gets **one** Guild Voice channel.

**Fixed pool first** (`DISCORD_RUN_VOICE_CHANNEL_IDS`, comma-separated, e.g. `Raid #1,Raid #2` ids):

- The Run gets the **first pool channel no other Run holds** (held = some Run's `RunDiscordPost.voiceChannelId`, also when its fetch failed this pass). Two Runs starting in the same pass get different channels; a channel released in the same pass is free again.
- Pool channels are **never created, renamed or deleted** — the bot only assigns them (`voice-channel`) and releases them (`clear-voice-channel`). They keep their own name and permissions.
- **Run ends** (`COMPLETED` / `CANCELLED` / app-archived): released right away, even while people are still connected.
- A pool channel deleted mid-Run (Unknown Channel) is cleared and the Run gets the next free one. A pool id that does not resolve to a GuildVoice channel is skipped.
- Pool unset or every channel taken → the temporary channel below.

**Temporary fallback** — the bot creates one channel:

- **Name:** `Raid with <Raid Lead>` (`formatRunVoiceChannelName`), where the Raid Lead part is the assigned Raid Lead's `User.name`. Human-readable (not slugged); never `Run.title`, the Start Run actor or a roster member. Renamed if the name changes while the Run is running.
- **Where:** the dedicated `DISCORD_RUN_VOICE_CATEGORY_ID` category — never the text Run category (voice channels take no part in CURRENT/NEXT ordering). Permissions are inherited from that category; there are no per-participant overwrites.
- **Lifecycle** (`listSyncWork.voiceChannels`, `src/discord-bot/voice-channels.ts`):
  - `IN_PROGRESS`: the channel is kept, **even when nobody is in it yet**.
  - `COMPLETED` / `CANCELLED` / app-archived: kept **while anyone is connected**; on the first sync pass after it becomes empty it is deleted, and `RunDiscordPost.voiceChannelId` is cleared only after the delete succeeded.
  - No retroactive creation: a Run that ended before the bot observed it gets no voice channel.
- **Independence:** voice is Run-level infrastructure — created regardless of Quiet Hours or anyone's DM preferences, and independent of the text channel's retirement/transcript.
- **Failures never affect the Run:** creation errors (incl. Missing Permissions) persist nothing and retry next poll; Unknown Channel clears the stored id (and, while still `IN_PROGRESS`, recreates once); Missing Permissions / transient errors during cleanup keep the id for a retry; a stored id that is not a voice channel is never deleted or replaced (operator error is logged).
- **Requires** the `GuildVoiceStates` gateway intent (non-privileged; `src/discord-bot/intents.ts`) so member counts are current, and the bot needs **Manage Channels**, **View Channel** and **Connect** visibility in the voice category.
- **`DISCORD_RUN_VOICE_CATEGORY_ID` controls first creation only.** Unset → no new voice channels. An id that is not a category → logged on passes with creation work, nothing created, no fallback. In both cases channels created earlier are still kept, renamed and cleaned up by the rules above, so removing the variable never orphans them.
- **Create → persist:** a new channel is linked (and treated as the Run's channel) only after `RunDiscordPost.voiceChannelId` is recorded. If recording fails, the bot deletes the just-created channel (best effort) and the next poll retries cleanly; if that delete also fails it logs `ORPHANED VOICE CHANNEL` with the Run and channel id for manual cleanup.
- **Final Setup link:** the Final Setup post shows `Voice: <#id>` after the participant sections and before the LFG footer, with the same precedence as the Raid Invite (this pass's voice outcome, even when it is null, else the persisted `voiceChannelId`). A channel created in the same pass as the first Final Setup send is linked in that send. The bot records the id it rendered in `RunDiscordPost.lastStartVoiceChannelId`. While the Run is `IN_PROGRESS` and not archived, a mismatch with `voiceChannelId` (voice added, replaced or cleared) makes the existing post stale, and the bot edits it in place without a roster-version bump. Final Setup never provisions voice. The web Start Run preview never shows a Voice line.

#### `/guide`

`/guide booster` and `/guide raidlead` reply ephemerally with a link (text + link button) to the guide's plain Discord channel in the current guild — no threads. The channel ids live in `src/discord-bot/guide-channels.ts`, which the publishing scripts also use as their default target (see [Publishing the Discord guides](OPERATIONS.md#publishing-the-discord-guides)). Unknown subcommands are ignored.

#### `/mysignups`

Read-only, ephemeral, registered per-guild (`npm run bot:register-commands`). Groups the same flat per-Character rows `signupService.getMyRuns` returns into one line per Run + participation type — "Offered: A, B, C · Selected: B" — matching the Web My Runs presentation. There is no `/signup` command: the Run embed's buttons are the only signup entry point, so Web and Discord never maintain two independent flows.

#### Discord bot: Deferred

`/runs` browse command; Discord-side Raid Lead/Admin actions other than Archive Run (roster selection and Strike management stay Web-only); preferred/ranked Character offers.

**Shipped (do not re-list as missing):** Discord role → access sync for Raid Booster / Lootbuddy Discord-derived flags (`discord-role-access-sync.service.ts`); run channel naming already includes difficulty / run-type / coverage segments from structured Run fields.

##### Run lifecycle → Discord

```text
BoostingHub Run becomes OPEN (signup-available) while its raid-ID week is CURRENT or NEXT
  → per-Run Discord channel created under DISCORD_RUN_CATEGORY_ID (position-reconciled in the same sync pass)
  → signup embed posted into that channel
  → User interactions (Signup / Lootbuddy / Cancel) update the same message
  → Wednesday 06:00 Europe/Berlin rollover: same channel, same category, moves above #next-id into the CURRENT section (no DB write)
  → Raid Lead publishes the roster
  → final roster embed posted into the SAME channel
  → republish edits that same roster message
  → completion/cancellation: channel kept under closed naming, not deleted
  → schedule ages into PAST: same channel moves into DISCORD_RUN_ARCHIVE_CATEGORY_ID holding (Run.archivedAt untouched)
  → App archive: transcript posted, then the Run's text channel is deleted
  → Restore Archive: revokes delete authority; a channel that was already deleted is not resurrected
```

Every channel move is reconciled by the independent `channels` lane (see "Channel reconciliation" above), whether or not the signup/roster message for that Run currently needs any other update.

The HTTP contract of the bot is in [API.md](API.md#discord-bot-api). One-time product announcements use `DISCORD_ANNOUNCEMENT_CHANNEL_ID` and the `global-announcements` routes: `src/discord-bot/global-announcements.ts` owns the content, the server only records that a key was delivered, so a key is never posted twice.

### Operational analytics and system health

- `/manage/analytics` (`operationalAnalyticsService`, ADMIN / OWNER): operational counts over an optional `from` / `to` range. No financial metrics.
- `/manage/system` (`systemHealthService`, ADMIN / OWNER): per-provider health derived from `IntegrationEvent` rows (`BLIZZARD`, `WARCRAFT_LOGS`, `DISCORD`, `RAIDER_IO`, `SYSTEM`, `BACKUP`), recent events, backup status, plus two manual actions (`adminSystemForceRefreshAllAction`, `adminSystemWclAutoAuditPassAction`). A restore verification is only shown when it was explicitly recorded, never inferred from a dump's existence.

## Technical decisions

Decisions a new maintainer should know before changing them. The detailed rules are in the sections above.

| Decision | Why |
| --- | --- |
| MVCS inside one Next.js app | Eligibility, roster and attendance rules must stay testable outside React |
| The Discord bot is a separate process that only uses `/api/bot/*` | Web and Discord can never drift into different rules; the bot holds a gateway connection |
| Better Auth uses Kysely on a shared `pg.Pool` | Its Prisma adapter targets Prisma 7; one pool protects a small connection limit |
| Prisma 8 release candidate | Chosen early; see the residual risk in [HANDOVER.md](HANDOVER.md#technical-debt) |
| Discord is the only login, Battle.net only a game-account link | One identity; Battle.net user tokens are never stored |
| Boosting Roles live on the User and have no difficulty | One account-level capability; difficulty stays a Run concept |
| Lockouts inform, schedule conflicts block | Lockout data can lag; a < 2 h Character conflict is a hard fact |
| Start Run is the freeze point, not Publish | Rosters stay editable until the raid really starts |
| Attendance and audit facts are stored, verdicts computed at read time | Rule changes never need a new Warcraft Logs fetch |
| Warcraft Logs fights are assigned by time, content and roster, never by guessing | Several Runs can share one report; ambiguous fights wait for a manager |
| External jobs are one-shot processes under systemd timers | The app owns no timer; PostgreSQL advisory locks prevent overlap |
| No financial domain | Removed on purpose (migration `20261009T1352_remove_payout_settlement`) |
| Schema changes only move forward | Rollback never reverses a migration; a restore is a separate operator decision |
| HTTP security headers from `next.config.ts` | HSTS, nosniff, frame denial, referrer and permissions policies; `poweredByHeader: false`. CSP is Report-Only until an inventory is proven safe — see [OPERATIONS.md](OPERATIONS.md#security-checklist) |
| Discord sync: Raid Invites only as `notificationDms` | Empty `raidInvites` lane removed (audit A19); web and bot must co-deploy |

## Git workflow

BoostingHub uses GitHub. The remote is private.

### Stable branch

`main` is the only stable branch.

It represents integrated, validated, usable application state. Do not do normal feature development on `main`.

Each meaningful feature starts from updated `main`:

```bash
git checkout main
git pull --ff-only
git checkout -b feature/<feature-name>
```

Exact Git commands may vary.

### Feature branches

Use `feature/<domain-feature>`.

Branches represent coherent business features, not pages.

A character-management branch may change `/characters`, `/dashboard`, `/profile`, services, the database, and docs, because those surfaces share the same domain.

### Branch granularity

Feature/domain based, not page based.

Good:

- `feature/character-management`
- `feature/run-management`
- `feature/run-lifecycle-attendance`
- `feature/profile-settings`
- `feature/blizzard-integration`
- `feature/warcraftlogs-integration`
- `feature/notifications`
- `feature/attendance-correction`

Bad:

- `feature/dashboard`
- `feature/runs-page-button`
- `feature/profile-card`
- `feature/change-badge-color`
- `feature/change-button`

Dashboard, My Runs, Profile, and Manage copy or layout changes belong to the feature that changes the underlying business behavior.

### Commit granularity

Use meaningful commits. Do not commit after every tiny change. Do not collapse a substantial feature into one unstructured commit either.

Target about 2–5 logical commits for a substantial feature where that split is natural. Small features may need only one or two.

Examples for character management:

```text
feat(characters): add persistent character management domain
feat(characters): add character management interface
test(characters): cover ownership and lifecycle rules
docs(characters): document character management workflow
```

WIP or checkpoint commits are acceptable on the feature branch. History that lands on `main` should stay clean.

### Validation before PR

Before opening or merging a pull request, the branch must pass:

- database / Prisma verification where applicable
- migration checks where applicable
- lint
- typecheck
- production build
- complete test suite

Never intentionally merge failing code into `main`.

Feature branches may be pushed at useful checkpoints. Not every commit has to be production-ready.

### Merge

Default for completed feature branches:

1. Push the feature branch
2. Open a pull request
3. Validate
4. **Squash Merge** into `main`
5. Delete the feature branch

Squash Merge gives `main` one cohesive commit per feature while allowing incremental commits during development.

Do not squash or rewrite the initial baseline commit (`chore: establish BoostingHub baseline through roster management`).

### Cleanup

Delete the merged feature branch after squash merge.

### Emergency / fix branches

Use `fix/<issue-name>` for independent defects that are not part of an in-flight feature.

Use `docs/<topic>` or `chore/<task-name>` for documentation and repository hygiene that is not a product feature. The repository is public; never commit secrets, production data or personal data.
