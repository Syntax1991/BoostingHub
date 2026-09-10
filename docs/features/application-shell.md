# Application shell

## Purpose

Give authenticated operators a persistent dark operations UI for the Phase 1 routes.

## User flow

1. Sign in at `/` with Discord or a development identity.
2. Land on `/dashboard`.
3. Move between Runs, My Runs, Characters, Profile. Open a Run from those lists at `/runs/[runId]`.
4. Raid leads and admins also see Manage, with a role-based sub-nav (Overview / Runs; ADMIN also Booster Access / Users).

## Permissions

- All app routes: authenticated `ACTIVE` user
- `/manage*`: `RAID_LEAD` or `ADMIN`, enforced in controllers
- `/manage/booster-access`, `/manage/users`: `ADMIN` only

## Models / services / controllers

- Models: User, Character, BattleNetConnection, BattleNetImportSession, BoosterAccess, Raid, Run, RunSignup, CharacterRaidLockout, RunRoster, RunAttendance, RunSettlement, RunPayoutEntry, ActivityEvent
- Services: dashboard, run (including create/lifecycle), run detail, signup, character, battle-net, character-blizzard, profile, lockout, booster access, management hub, user management, roster, attendance, payout
- Controllers: `dashboard.controller`, `app.controller`, `run.actions`, `blizzard.actions`, `booster-access.actions`, `user-management.actions`, `auth.controller`, `auth.actions`

## Limitations

- Character create/edit/deactivate/reactivate is implemented for the owning user
- Optional Battle.net connect/import/link and Refresh for linked characters when configured
- Run create/edit/open/signup-window/cancel/start/complete, attendance, and completed-run payouts are implemented
- Profile gold/wallet panels stay reserved; run payouts live on `/runs/[runId]`
- Signup, withdraw, and raidlead/admin roster publish are implemented
