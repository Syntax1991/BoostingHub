# User Strikes

## Purpose

A disciplinary history record against a `User`. This is BoostingHub-owned internal administration, independent of Run operations.

BoostingHub owns Users, Characters, Booster Qualifications, Runs, Signups, Rosters, and this Strike history. **Attendance tracking and payout/financial-deduction handling are an external, operational workflow (Dawn Boosting) and are not part of BoostingHub.** Strike is intentionally uncoupled from both — it has no relation to `RunAttendance` and does not touch payout data.

Nothing here is automatic: every Strike is an explicit staff action. There is no automatic sanction, no automatic expiry, and no severity scoring.

## Model

`Strike`: `userId` (subject, required), `runId` (nullable), `reason` (required), `notes` (optional, staff-only), `status` (`ACTIVE` \| `REVOKED`), `createdById`, `revokedAt` / `revokedById` / `revokedReason`, timestamps.

Subject is always `User`, never `Character` — a Strike survives account role changes, Character deactivation, and BoosterQualification changes. No severity. No expiry (`expiresAt` is explicitly not implemented; "active" means `status === ACTIVE`, permanently, until an ADMIN revokes it). No hard delete — revocation is the only correction path and keeps the row, so history is never lost.

## Run relation

`runId` is optional: most Strikes reference the Run an incident happened on, but ADMIN may also record a general disciplinary note with no Run context (e.g. a pattern of behavior not tied to one run).

Run association is proven using **BoostingHub's own signup history** (`RunSignup`) — never Attendance, which this feature does not read or write.

## Authorization

| Action | ADMIN | RAID_LEAD | USER |
| --- | --- | --- | --- |
| Create (no `runId`) | yes | no (`STRIKE_RUN_REQUIRED`) | no |
| Create (with `runId`) | yes, any Run | only a Run they manage (`canManageRun`), and only for a User with signup history on it (`STRIKE_USER_NOT_ASSOCIATED` otherwise) | no |
| Revoke | yes | no (`STRIKE_REVOKE_FORBIDDEN`, even for a Strike they created) | no |
| Read own history | n/a | n/a | yes (no internal `notes`) |
| Read another User's history | yes | only via a Run they manage | no |

## Visibility

- ADMIN sees full detail: reason, internal notes, linked Run, creator, revoke metadata.
- USER sees their own complete history (active and revoked): reason, linked Run, date, status, revoke reason. Internal `notes` are never shown to the User, even for their own Strikes.

## UI

- `/manage/users/[userId]`: **Strikes** card (between Booster qualifications and Audit) — full detail, Add strike (general, ADMIN), Revoke (ADMIN-only, reason required).
- `/profile`: read-only Strikes card — own history, no internal notes.
- Canonical Run detail (`/runs/[runId]`), **Signups tab** (manager view): a per-row **Add strike** action, deriving `runId`/`userId` from BoostingHub's own signup row. This is not on the Attendance tab, and marking any Attendance status never creates a Strike — Attendance belongs to Dawn Boosting, not this feature.

No dedicated `/manage/strikes` page exists.

## Activity / Audit

`STRIKE_ADDED` and `STRIKE_REVOKED` follow the existing `ActivityEvent` convention: `userId` is the acting staff member, and the free-text `message` embeds `targetUserId=`/`strikeId=` (and the Run title when linked). Internal notes are never included in the audit message.

## MVCS

- Model: `Strike`
- View: Strikes card (`/manage/users/[userId]`, `/profile`), Signups-tab Add-strike action
- Controller: `strike.actions.ts`
- Service: `strike.service.ts`
- Repository: `strike.repository.ts`

## Deferred

Strike expiry/decay, severity levels, appeals workflow, automatic sanctions (including any automatic Strike-from-attendance-status or BoosterQualification-revoke-from-strike-count), a dedicated `/manage/strikes` review page, Discord synchronization, automated bot enforcement, and any financial deduction — that entire domain belongs to Dawn Boosting's own operational workflow, outside BoostingHub.
