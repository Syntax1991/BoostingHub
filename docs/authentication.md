# Authentication and authorization

## Discord OAuth

Primary login method. Configured through Better Auth `socialProviders.discord` when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set.

Redirect URL:

```text
http://localhost:3000/api/auth/callback/discord
```

Email is not required. Discord profile maps into display name, avatar, `discordUserId`, and `discordUsername`.

First sign-in creates a `user` row. Prisma defaults are `accountRole=USER` and `accountStatus=ACTIVE`. Role and status are server-owned (`input: false`) so OAuth cannot self-promote. ADMIN may later change `accountRole` through user management.

Trusted request handlers reload the session user with `userRepository.findAuthenticatedById`, so role changes take effect on the next request without invalidating the session cookie.

A new Discord user has no characters, signups, or roster rows. Pages must render empty states instead of assuming seed fixtures.

## Battle.net (secondary connection)

Battle.net is **not** a login provider. Discord (or a development credential identity) remains the BoostingHub session.

When `BLIZZARD_*` env vars are set, an authenticated user may connect a regional Battle.net account from `/characters` to import or link WoW characters. That OAuth flow uses dedicated routes under `/api/integrations/battlenet/*`, not Better Auth. User Battle.net tokens are never persisted. See [blizzard-integration.md](features/blizzard-integration.md).

## Development authentication

Local tests and QA still need deterministic identities. Discord OAuth is the real user path.

Development login is shown only when:

- `NODE_ENV !== "production"`
- `DEV_AUTH_ENABLED === "true"`

It uses Better Auth email/password against **credential** accounts only. Discord-only users are omitted from the picker because they have no password.

The login panel is labeled as development and uses warning styling so it cannot be mistaken for Discord.

This is not a silent production bypass. Production runtime disables the credential provider and rejects the server action.

Seeded identities and `DEV_AUTH_PASSWORD` are documented in [development.md](development.md).

## Development account bootstrap

`npm run db:seed` wipes `accountRole`/`accountStatus` and Booster qualifications for every user, including your own real Discord-linked developer account. Development account bootstrap exists solely to restore that ONE account automatically after a Discord sign-in, so re-seeding never leaves you locked out of ADMIN screens locally.

Enabled only when all of the following hold:

- `NODE_ENV !== "production"` — a code-level check, not just configuration. Even if `DEV_ACCOUNT_BOOTSTRAP_ENABLED` is accidentally left `"true"` in a deployed environment, production is a hard no-op.
- `DEV_ACCOUNT_BOOTSTRAP_ENABLED === "true"`
- `DEV_ADMIN_DISCORD_USER_ID` is set to your real Discord user ID (snowflake)

Targeting is by exact `User.discordUserId` match only — never username, display name, email, or database `User.id`. A signed-in user whose `discordUserId` doesn't match exactly is completely untouched (0 writes).

Wired as Better Auth's `databaseHooks.session.create.after` (see `src/auth/auth.ts`), which fires once per sign-in for both a brand-new User (first Discord sign-in after a DB reset) and an existing one (privileges reset by re-seeding) — there is no separate first-login code path. Discord sign-in creates/persists the `user` row first, as normal; bootstrap only ever evaluates an already-persisted User and never creates one itself.

On a match, it restores:

- `accountRole = ADMIN`, `accountStatus = ACTIVE`
- An `APPROVED` `BoosterQualification` row for `NORMAL`, `HEROIC`, and `MYTHIC` independently (exact per-difficulty match — the normal product rule that a difficulty never implies another is unchanged)

It is idempotent: an already-correct field is left untouched, including timestamps (`updatedAt`, `grantedAt`, `notes` do not churn on every login), and it never writes an `ActivityEvent` — normal ADMIN grant/revoke through `/manage/booster-access` continues to log Activity exactly as before; this only seeds/restores one development account's own qualifications, with `grantedById = null` to correctly represent a system bootstrap rather than a human admin's action.

There is no UI, no admin endpoint, and no client-visible flag for this — `DEV_ADMIN_DISCORD_USER_ID` is server-only configuration, never exposed to the browser. See [development.md](development.md) for setup and safe local verification.

## Session enforcement

`src/proxy.ts` redirects unauthenticated browsers away from app routes based on cookie presence. That check is not sufficient.

Controllers call:

- `requireUser()` / `requireUserOrRedirect()`
- `requireRaidLead()` / `requireManagerOrRedirect()`
- `requireAdmin()`

Management routes are enforced on the server. Users without `RAID_LEAD` or `ADMIN` are redirected to `/dashboard`.

## Persistence split

Better Auth uses Kysely on the shared `pg.Pool` because its Prisma adapter still expects Prisma 7's client. Prisma 8 uses the same pool for domain queries. The `user` table is the shared identity record.
