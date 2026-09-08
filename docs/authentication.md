# Authentication and authorization

## Discord OAuth

Primary login method. Configured through Better Auth `socialProviders.discord` when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set.

Redirect URL:

```text
http://localhost:3000/api/auth/callback/discord
```

Email is not required. Discord profile maps into display name, avatar, `discordUserId`, and `discordUsername`.

`accountRole` is server-owned (`input: false`) so OAuth cannot self-promote.

## Development authentication

When Discord credentials are missing, local work still needs identities.

Development login is shown only when:

- `NODE_ENV !== "production"`
- `DEV_AUTH_ENABLED === "true"`

It uses Better Auth email/password against seeded credential accounts. The login panel is labeled as development and uses warning styling so it cannot be mistaken for Discord.

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

Better Auth uses a `pg` Pool (Kysely) because its Prisma adapter still expects Prisma 7's client. Prisma 8 owns the schema/migrations and all domain queries. The `user` table is the shared identity record.
