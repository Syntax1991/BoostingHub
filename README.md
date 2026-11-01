# BoostingHub

Internal World of Warcraft boosting operations platform for boosters, lootbuddies, raid leads and administrators. The app brand is **Manawyrm Hub**.

It is a Next.js web application plus a separate Discord bot process for Run channels, signups, roster posts, schedule posts and DMs. The web app is the source of truth for rosters, attendance and administration.

**Project status:** final feature freeze and handover. See [docs/HANDOVER.md](docs/HANDOVER.md).

## Documentation

| Document | For |
| --- | --- |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Architecture, project structure, data model, local setup, tests, authorization, business rules, technical decisions |
| [docs/API.md](docs/API.md) | HTTP routes, Discord bot API, Server Actions, errors, integrations |
| [docs/USER.md](docs/USER.md) | Using the app and Discord as Booster, Raid Lead or Admin |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Release process, migrations, deploy scripts, smoke tests, rollback, planned repository restart |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Services, timers, configuration, monitoring, diagnosis, maintenance, backups and restore |
| [docs/HANDOVER.md](docs/HANDOVER.md) | Real project status, debt, risks, open decisions, takeover steps, AI-assisted development |

## Tech stack

Next.js App Router, React, TypeScript, Tailwind CSS, PostgreSQL 15+, Prisma ORM 8 (release candidate), Better Auth, Zod, discord.js, Vitest, npm and Node.js 24. Exact versions are in `package.json`.

## Quick start

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run db:emit
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run db:seed` deletes all existing data in the local database named by `SEED_CONFIRM_DATABASE`, then adds test data. It refuses production.

Set `DATABASE_URL` in `.env` first, then open <http://localhost:3000>. Development identities, Discord login, the test database and the Blizzard requirement for Add Character are explained in [Local development](docs/DEVELOPER.md#local-development).

## Common commands

```bash
npm run dev            # web app (checks the DB schema first)
npm run bot:dev        # Discord bot
npm run lint
npm run typecheck
npm test
npm run test:full      # resets TEST_DATABASE_URL, then runs all tests
npm run build
npm run db:status
npm run db:verify
```

## Contributing

Work on a branch, validate locally and open a pull request. See [Git workflow](docs/DEVELOPER.md#git-workflow). The repository is public: never commit secrets, production data or personal data.
