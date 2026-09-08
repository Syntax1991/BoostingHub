# Application shell

## Purpose

Give authenticated operators a persistent dark operations UI for the Phase 1 routes.

## User flow

1. Sign in at `/` with Discord or a development identity.
2. Land on `/dashboard`.
3. Move between Runs, My Runs, Characters, Profile.
4. Raid leads and admins also see Manage.

## Permissions

- All app routes: authenticated `ACTIVE` user
- `/manage*`: `RAID_LEAD` or `ADMIN`, enforced in controllers

## Models / services / controllers

- Models: User, Character, BoosterAccess, Raid, Run, RunSignup, CharacterRaidLockout, ActivityEvent
- Services: dashboard, run, signup, character, profile, lockout, booster access
- Controllers: `dashboard.controller`, `app.controller`, `auth.controller`, `auth.actions`

## Limitations

- Management create/edit/roster actions are disabled with explanation
- Blizzard refresh is not claimed to work
- Payout panels are reserved empty, not fake finance
- Signup and withdraw are implemented; raidlead roster selection is not
