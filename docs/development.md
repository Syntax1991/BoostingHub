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
npm run dev
```

`--legacy-peer-deps` is required because Better Auth still optionally peers Prisma 5–7 while this app uses Prisma 8 for domain data.

## Prisma 8 workflow

1. Edit `src/prisma/contract.prisma`
2. `npm run db:emit` (replaces Prisma 7 `generate`)
3. `npx prisma migration plan --name change_name`
4. `npm run db:migrate`
5. Update seed/docs if domain behavior changed

`npm run db:verify` checks the live database against the emitted contract.

Queries use `db.orm.public.Model`, not Prisma 7 `prisma.model.findMany`.

## Seed

`npm run db:seed` wipes domain and auth rows, then inserts deterministic users, characters, access, lockouts, runs, signups, and activity.

It is safe to re-run. It is not random. Seed is a fixture, not required production state; see **Seed policy** below.

Default password: `dev-login-only` (override with `DEV_AUTH_PASSWORD`).

`src/services/signup.service.test.ts` and `src/services/roster.service.test.ts` use the seeded database. Re-seed after those tests if you need the original demo rows. Roster tests mutate **Roster Lab Heroic**.

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

Timestamps are stored in UTC. `src/lib/datetime.ts` formats them in `Europe/Berlin` until per-user timezones exist. Month names are avoided (`Thu 10/09/2026 21:00`) because Node and browsers disagree on `en-GB` abbreviations such as `Sept` vs `Sep`.

## GitHub workflow

Stable branch is `main`. Feature work uses `feature/<domain-feature>`, not a branch per page.

Open a pull request, validate, **squash merge** into `main`, then delete the feature branch.

See [git-workflow.md](git-workflow.md) for branch naming, commit granularity, PR validation, and merge rules.

## Seed policy

Seed data is a development and test fixture.

It is useful for local QA and deterministic Vitest runs. It is **not** required production state.

The application must work when the database contains only a newly authenticated Discord user: zero characters, zero runs, zero signups, zero roster data.

Do not encode seeded user IDs or seeded run titles in production services.

## Discord login vs development identities

Discord OAuth is the real authentication path.

Development identities remain for automated tests and local QA. They use Better Auth email/password against **credential** accounts only, and only when:

- `NODE_ENV !== "production"`
- `DEV_AUTH_ENABLED === "true"`

Production must never expose the identity picker. Do not remove the mechanism while tests and local QA still depend on it.

## Incremental Prisma migrations

`npx prisma migration plan --name slug` can emit a full recreate if `--from` is omitted incorrectly. Plan from the previous migration directory:

```bash
npx prisma migration plan --name change_name --from 20260908T1443_roster_draft_publish
```
