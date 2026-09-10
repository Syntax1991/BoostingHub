# Authentication and authorization

## Discord OAuth

Primary login method. Configured through Better Auth `socialProviders.discord` when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set.

Redirect URL:

```text
http://localhost:3000/api/auth/callback/discord
```

Email is not required. Discord profile maps into display name, avatar, `discordUserId`, and `discordUsername`.

First sign-in creates a `user` row. Prisma defaults are `accountRole=USER` and `accountStatus=ACTIVE`. Role and status are server-owned (`input: false`) so OAuth cannot self-promote.

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

## Session enforcement

`src/proxy.ts` redirects unauthenticated browsers away from app routes based on cookie presence. That check is not sufficient.

Controllers call:

- `requireUser()` / `requireUserOrRedirect()`
- `requireRaidLead()` / `requireManagerOrRedirect()`
- `requireAdmin()`

Management routes are enforced on the server. Users without `RAID_LEAD` or `ADMIN` are redirected to `/dashboard`.

## Persistence split

Better Auth uses Kysely on the shared `pg.Pool` because its Prisma adapter still expects Prisma 7's client. Prisma 8 uses the same pool for domain queries. The `user` table is the shared identity record.
