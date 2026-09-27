# Discord Raidbooster Access Design

## Goal

Grant the existing account-level Booster capability automatically when a signing-in Discord user holds the configured `raidbooster` guild role, while preserving every manual Booster grant and revoke operation.

## Approved behavior

- `User.isBooster` remains the only authoritative Booster capability inside BoostingHub.
- `boostingRoleService.setRole` and the existing ADMIN / OWNER UI remain unchanged.
- On every Discord sign-in, BoostingHub reloads the persisted User and reads the immutable `discordUserId`.
- The server queries the configured Discord guild member and checks for `DISCORD_BOOSTER_ROLE_ID=1527022823103791104`.
- A matching role grants `User.isBooster = true` if needed.
- A missing role, missing member, missing configuration, or Discord API failure leaves the stored value unchanged and never blocks sign-in.
- The sync is additive only: it never automatically revokes Booster access.
- A manual revoke while the Discord role is still present is re-granted on the next Discord sign-in.
- Automatic grants do not impersonate a human admin and do not create the existing manual `ActivityEvent` audit entries.

## Boundaries

- No schema or migration change.
- No change to signup, roster, authorization, Lootbuddy, or account-role rules.
- No background synchronization; login is the synchronization seam.
- Discord bot token, guild ID, and booster role ID remain server-only environment configuration.
