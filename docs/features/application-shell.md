# Application shell

## Purpose

Give authenticated operators a persistent dark operations UI for the Phase 1 routes.

## User flow

1. Sign in at `/` with Discord or a development identity.
2. Land on `/dashboard`.
3. Move between Runs, My Runs, Characters, Profile. Open a Run from those lists at `/runs/[runId]`.
4. Raid leads and admins also see Manage.

## Permissions

- All app routes: authenticated `ACTIVE` user
- `/manage*`: `RAID_LEAD` or `ADMIN`, enforced in controllers
- `/manage/booster-access`: `ADMIN` only

## Models / services / controllers

- Models: User, Character, BoosterAccess, Raid, Run, RunSignup, CharacterRaidLockout, ActivityEvent
- Services: dashboard, run, run detail, signup, character, profile, lockout, booster access, roster
- Controllers: `dashboard.controller`, `app.controller`, `auth.controller`, `auth.actions`

## Limitations

- Character create/edit/deactivate/reactivate is implemented for the owning user
- Run create/edit/cancel is not implemented
- Blizzard refresh is not claimed to work
- Payout panels are reserved empty, not fake finance
- Signup, withdraw, and raidlead/admin roster publish are implemented
