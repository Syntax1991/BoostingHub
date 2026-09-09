# Architecture

Boostting Bot is a modular Next.js application with an internal **MVCS** boundary. There is no separate backend service.

## Stack

- Next.js 16.3 App Router, React, TypeScript, Tailwind CSS
- PostgreSQL 15+
- Prisma ORM 8 for domain persistence
- Better Auth for sessions and OAuth
- Zod at HTTP/form boundaries

MVCS is used because later boosting operations will accumulate non-trivial rules around eligibility, lockouts, rostering, attendance, and payouts. Those rules must stay testable outside React trees.

## Layer responsibilities

### Model

Persistent domain entities, Prisma contract, relationships, and domain enums. No presentation logic.

### View

React pages and components: layout, tables, badges, filters, empty states. Views consume prepared data. They do not query Prisma and do not decide whether a signup transition is legal.

Client components are limited to interaction islands (`AppShell` navigation, `Button`, Discord OAuth click, run filters, signup dialog, withdraw button, roster builder, run detail tabs, character form, character lifecycle, booster access request/review dialogs, run create form, run edit/cancel/start/complete dialogs, attendance table, payout settlement actions, manager lifecycle actions). Shared presentation primitives are not marked `"use client"` so tables stay server-rendered.

### Controller

Server actions, route handlers, and page loaders. Typical shape:

1. Authenticate
2. Authorize
3. Validate input
4. Call a service
5. Return a result

Better Auth's `/api/auth/*` handler is the authentication controller for OAuth and credential login.

### Service

Application and business rules: booster access request/review, booster access matching, lockout conflict, run/signup state machines, run create/edit/open/signup-window/cancel/start/complete, signup eligibility, roster draft/publish, attendance snapshot/update/completeness, completed-run payout settlement, canonical run-detail DTO shaping, character identity/lifecycle, dashboard composition.

### Repository

Prisma 8 access lives here (`orm.Model` via `src/lib/prisma.ts`). Views and most controllers never import Prisma.

## Persistence boundary

```text
View → Controller → Service → Repository → Prisma 8 (`db.orm.public`)
                                         → PostgreSQL
```

Better Auth (Kysely) and Prisma 8 share one `pg.Pool` (`src/lib/pg-pool.ts`) so they cannot exhaust a small hosted connection limit against each other. Domain tables are owned by Prisma migrations. The `user` table is the shared identity record.

## Authorization boundary

Cookie presence in `src/proxy.ts` is an optimistic redirect only.

Server-side enforcement:

- `requireUser()`
- `requireRaidLead()`
- `requireAdmin()`
- `requireAdminOrRedirect()`
- `requireManagerOrRedirect()`
- `canManageRun` / `assertCanManageRun` (raid lead owns assigned runs; admin owns all)

Hidden buttons are not an authorization control.

## Directory structure

```text
src/
  app/             View routes and the Better Auth route handler
  components/      View components
  controllers/     Thin application boundary
  services/        Business rules
  repositories/    Prisma access
  models/          Domain enumerations
  validators/      Zod schemas
  auth/            Auth configuration and authorization helpers
  lib/             Cross-cutting utilities
  prisma/          Prisma 8 contract, client, seed
```

## Rules for later contributors

1. Do not put business rules in page components.
2. Do not call Prisma from Views.
3. Do not grow Controllers into domain engines.
4. Keep run status and signup status separate.
5. Keep account roles separate from BOOSTER / LOOTBUDDY participation.
6. Keep signup eligibility in Services. Views receive evaluated options and `canWithdraw`.
7. Keep roster draft selection off `RunSignup.status` until Publish. Views must not invent composition or publish rules.
8. Keep booster eligibility in `BoosterAccessService`. RAID_LEAD roster tools may read access; only ADMIN mutates it globally.
9. Update documentation in the same change that alters architecture or domain behavior.
10. Treat seed data as a development/test fixture, not required production state.
11. Do not hard-code seeded user or run IDs in production services.
