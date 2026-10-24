# Application shell

## Purpose

Give authenticated operators a persistent dark operations UI for the Phase 1 routes.

## User flow

1. Sign in at `/` with Discord or a development identity.
2. Land on `/dashboard`. The dashboard's **Recent Activity** (community-wide operational events) is shown to raid leads and admins only; regular users never receive those events.
3. Move between Runs, My Runs, Characters, Profile, Settings. Open a Run from those lists at `/runs/[runId]`.
4. On mobile widths (`md` and below), open the header menu for an off-canvas left drawer (Main + Management). Desktop keeps the persistent SideNav. There is no mobile bottom navigation.
5. Raid leads and admins also see Manage, with a role-based sub-nav (Overview / Runs / Schedule; ADMIN also Users / Characters / Raid Catalog / Analytics / System).

## Permissions

- All app routes: authenticated `ACTIVE` user
- `/manage*`: `RAID_LEAD` or `ADMIN`, enforced in controllers
- `/manage/users` (All Users + Pending Boosting Access; old `/manage/boosting-roles` and `/manage/booster-access` redirect here): `ADMIN` only

## Models / services / controllers

- Models: User, Character, BattleNetConnection, BattleNetImportSession, BoosterAccess, Raid, Run, RunSignup, CharacterRaidLockout, RunRoster, RunAttendance, ActivityEvent
- Services: dashboard, run (including create/lifecycle), run detail, signup, character, battle-net, character-blizzard, profile, lockout, booster access (legacy requests), boosting roles, management hub, user management, roster, attendance
- Controllers: `dashboard.controller`, `app.controller`, `run.actions`, `blizzard.actions`, `booster-access.actions`, `boosting-role.actions`, `user-management.actions`, `auth.controller`, `auth.actions`

## Limitations

- Character create/edit/deactivate/reactivate/delete is implemented for the owning user (admins can also delete via Character Operations)
- Optional Battle.net connect/import/link and Refresh for linked characters when configured
- Run create/edit/open/signup-window/cancel/start/complete, and attendance are implemented
- Signup, withdraw, and raidlead/admin roster publish are implemented
