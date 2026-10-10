# Development

## Prerequisites

- Node.js 24
- npm
- PostgreSQL 15+ (local, Docker, or Prisma Postgres via `npx create-db@latest`)

## First run

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

## Prisma 8 workflow

1. Edit `src/prisma/contract.prisma`
2. `npm run db:emit` (replaces Prisma 7 `generate`)
3. `npx prisma migration plan --name change_name`
4. `npm run db:migrate`
5. Update seed/docs if domain behavior changed

`npm run db:verify` checks the live database against the emitted contract. `npm run db:status` lists applied / pending migrations for DATABASE_URL.

### Schema check before `npm run dev`

`npm run dev` first runs a **read-only** check (`predev` → `scripts/check-dev-db-schema.ts`) that the database in DATABASE_URL is on the committed migration history and current. It prints which database it checked (host/port/name only) and stops with an explicit instruction instead of letting the app fail later with `SqlQueryError: column … does not exist`:

- **behind** (pending migrations) → `npm run db:migrate`
- **not reachable** → start Postgres / check DATABASE_URL
- **off the migration history** → see below

It never migrates, signs or resets anything. `SKIP_DEV_DB_SCHEMA_CHECK=1 npm run dev` bypasses it (it then says the database is unverified). Deployment (`deploy/update-server.sh` runs `db:migrate` itself) and the automated-test database (`npm run test:db:reset`) are unaffected.

**Only apply committed migrations to the shared development database.** Plan and try a branch's migration on an isolated database (a fresh `*_test_*` database, migrated + seeded), not on DATABASE_URL: if the branch is rebased and its migration re-planned, the shared database is left on a contract hash that is not in the committed graph.

### Development database off the migration history

`MIGRATION.MARKER_NOT_IN_HISTORY` means the database's marker is a hash no committed migration produces — typically a branch's draft migration that was later re-planned. `db migrate` cannot walk from there, and **`prisma db update` is the wrong fix**: it diffs tables and would skip the committed migrations' data steps (e.g. `20260927T1408_boosting_roles_on_user` carries BoosterQualification approvals into `User.isBooster`).

Recover by putting the marker back on the committed chain, then migrating normally:

1. Back up the database (`pg_dump --format=custom`).
2. From `prisma_contract.ledger`, find the last migration the database actually ran and compare its `operations` with the committed migration(s) that replaced it; work out which committed node the live schema equals (plus anything the draft skipped).
3. `npx prisma db sign <committed migration dir or dir^>` — verifies the live schema against that exact contract first and writes nothing if it does not match. Apply any skipped committed migration with `npx prisma db migrate --to <dir>`, and sign again where the draft already made the change.
4. `npm run db:migrate`, then `npm run db:status` (**Up to date**) and `npm run db:verify` (**marker and schema match contract**).

Queries use `db.orm.public.Model`, not Prisma 7 `prisma.model.findMany`.

## Seed

`npm run db:seed` wipes domain and auth rows, then upserts reference raid content and inserts deterministic users, characters, access, lockouts, fixture runs, signups, attendance, and activity.

It is safe to re-run. It is not random. Seed is a fixture, not required production state; see **Seed policy** below.

Default password: `dev-login-only` (override with `DEV_AUTH_PASSWORD`).

`src/services/signup.service.test.ts`, `src/services/roster.service.test.ts`, `src/services/run-detail.service.test.ts`, and `src/services/character.service.test.ts` use the seeded database. Character tests create isolated users (`cm0000000001` / `cm0000000002`) and delete them afterwards. Run Management tests create isolated users (`rm0000000001`–`4`) and dedicated runs; they do not mutate Roster Lab. Re-seed after roster tests if you need the original demo rows. Roster tests mutate **Roster Lab Heroic**.

## Validation

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

## Temporary Prisma Postgres

If `npx create-db@latest` was used, unclaimed databases expire after 24 hours. Put the connection string only in `.env`. Claim the printed URL to keep the database.

## Time display

Timestamps are stored in UTC. Personal surfaces format them with the User's Settings timezone (default `Europe/Berlin`). Community/server authority — Run titles, Discord channel names, raid-ID week boundaries — remains `Europe/Berlin` via `DEFAULT_TIME_ZONE`. Month names are avoided (`Thu 10/09/2026 21:00`) because Node and browsers disagree on `en-GB` abbreviations such as `Sept` vs `Sep`.

## Product roadmap

Next ops epic (decision + tickets): [roadmap/lead-ops-confidence.md](roadmap/lead-ops-confidence.md).

## GitHub workflow

Stable branch is `main`. Feature work uses `feature/<domain-feature>`, not a branch per page.

Open a pull request, validate, **squash merge** into `main`, then delete the feature branch.

See [git-workflow.md](git-workflow.md) for branch naming, commit granularity, PR validation, and merge rules.

## Seed policy

Seed data is a development and test fixture.

It is useful for local QA and deterministic Vitest runs. It is **not** required production state.

The application must work when the database contains only a newly authenticated Discord user: zero characters, zero runs, zero signups, zero roster data.

Seed itself does not require Battle.net — it inserts Characters directly. Interactive local QA of Add Character does: `BLIZZARD_*` must be set, since Class/Item Level have no manual fallback. Battle.net *account* linking stays optional on top of that and is documented in [blizzard-integration.md](features/blizzard-integration.md).

Do not encode seeded user IDs or seeded run titles in production services.

## Discord login vs development identities

Discord OAuth is the real authentication path.

Development identities remain for automated tests and local QA. They use Better Auth email/password against **credential** accounts only, and only when:

- `NODE_ENV !== "production"`
- `DEV_AUTH_ENABLED === "true"`

Production must never expose the identity picker. Do not remove the mechanism while tests and local QA still depend on it.

## Development account bootstrap

`npm run db:seed` resets `accountRole`/`accountStatus` and Boosting Roles for everyone, including your real Discord account. To avoid re-granting yourself ADMIN by hand after every reseed, set in `.env`:

```bash
DEV_ACCOUNT_BOOTSTRAP_ENABLED="true"
DEV_ADMIN_DISCORD_USER_ID="<your real Discord user ID>"
```

The next time that Discord account signs in (new or returning session), it is automatically restored to `ADMIN`/`ACTIVE` with the Booster role (`isBooster`). Hard-disabled in production regardless of these env vars; a non-matching Discord user is never affected; no Activity is logged for it. See [authentication.md](authentication.md#development-account-bootstrap) for the full behavior.

Leave `DEV_ACCOUNT_BOOTSTRAP_ENABLED="false"` unless you specifically need this, and never commit your real Discord user ID.

## Incremental Prisma migrations

`npx prisma migration plan --name slug` can emit a full recreate if `--from` is omitted incorrectly. Plan from the previous migration directory:

```bash
npx prisma migration plan --name change_name --from <previous migration dir or hash>
```

## Character management QA

Requires `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, and `BLIZZARD_REDIRECT_URI` set — Add Character always looks up Blizzard's public Character Profile.

1. Sign in with Discord (empty account) or a development identity.
2. Open `/characters` → **Add Character**, look up a real Region/Realm/Name (EU and US both valid), confirm Class and Item Level render read-only from Blizzard, then choose a specialization and add.
3. Open Details, edit name/realm/region/specialization; confirm Class and Item Level are not editable.
4. Confirm Dashboard and Profile counts follow `activeCharacters` / `totalCharacters`.
5. On `/runs`, a new active character can lootbuddy-sign without BoosterAccess and cannot booster-sign until an ADMIN grants matching BoosterAccess.
6. From character details, open the Discord booster application CTA (when configured); as ADMIN, grant the Booster role on `/manage/users/[id]` (or `/manage/boosting-roles`) and confirm booster signup becomes available on every difficulty.

The same vars also enable Battle.net account **Connect** on `/characters` and **Refresh** on linked character details — separately optional, ownership-verified, on top of the Add Character lookup above. Git workflow: [git-workflow.md](git-workflow.md).
