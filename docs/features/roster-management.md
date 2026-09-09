# Roster management

## Purpose

Let a **raid lead** or **admin** build a persistent draft roster for a run, validate it, and publish it. Publication writes final `RunSignup` statuses and moves the run to `PUBLISHED`.

This is internal operations tooling. It is not raid-group assignment, payouts, or attendance marking. Attendance after Start is documented in [run-lifecycle-attendance.md](run-lifecycle-attendance.md).

Canonical Run URL: `/runs/[runId]`. See [run-detail.md](run-detail.md). Run create/open/cancel: [run-management.md](run-management.md).

## Roles

| Account role | Roster access |
| --- | --- |
| `USER` | None. `/manage` redirects. Service mutations throw `RUN_NOT_MANAGEABLE`. |
| `RAID_LEAD` | Only runs where `user.id === run.raidLeadId`. |
| `ADMIN` | Every run. |

Account roles are not booster/lootbuddy identities. `BOOSTER` and `LOOTBUDDY` remain signup participation types.

## Run ownership

`canManageRun` / `assertCanManageRun` in `src/auth/authorization.ts` are the single ownership check.

- Being listed as `raidLeadId` does not grant a `USER` roster tools.
- A raid lead cannot roster another lead's run.
- Views do not re-implement this rule; they render data the service already authorized.

## Draft roster

Draft selection is **not** `RunSignup.status`. Checkbox clicks must not immediately become public `SELECTED`.

Each run has at most one `RunRoster` row:

- `state` is `DRAFT` until the first successful publish, then `PUBLISHED` even while a replacement draft is edited
- `version` increments on draft writes and on publish (stale clients get `ROSTER_ALREADY_CHANGED`)
- `publishedAt` / `publishedById` are set on successful publish

`RunRosterEntry` stores **currently draft-selected** signups (`selected = true`). Absence of a row means not draft-selected.

Chosen over a JSON blob or a `rosterDraftSelected` column because:

- drafts survive reload
- later group assignment can hang off the same roster row
- publication metadata is relational
- signup status stays the live published roster

Opening `/runs/[runId]` as a manager may create an empty `RunRoster` (`ensure`). A USER view does **not** call `ensure`. That does **not** change `RunStatus`. The first persisted draft selection on an `OPEN` run transitions `OPEN → ROSTERING` without closing signups (`signupsOpen` stays independent).

## Roster entries

Draft rows point at `RunSignup`. The live roster after publish is still those signup rows:

| Signup status | Meaning |
| --- | --- |
| `PENDING` | Offer exists; no current published decision for this row |
| `SELECTED` | Part of the published roster |
| `NOT_SELECTED` | Considered and not on the published roster |
| `WITHDRAWN` | Player left before lock; never selected; never resurrected |

`isBackup` is still player intent, not a status. Backups may be draft-selected.

## One user rule

**One selected participation per user per run.**

Selecting a second signup for the same user **replaces** the previous draft row. Silent double slots are forbidden. The service enforces this; the database cannot, because the path is `RunRosterEntry → RunSignup.userId`.

If one character is `SELECTED`, the user's other active offers on that run become `NOT_SELECTED` on publish. They are not all marked `SELECTED`.

## Composition

Targets come from the run (`desiredTankCount`, `desiredHealerCount`, `desiredDpsCount`), never hardcoded 2/4/14.

- Booster `TANK` / `HEALER` / `DPS` count toward those slots
- Lootbuddies (`LOOT_ONLY` and `PLAYING`) do **not** count as booster composition
- `PLAYING` has no assigned booster role in Phase 2, so it stays in the lootbuddy bucket

Mismatch is a **warning**, not an automatic hard block. A lead may draft 5/4 healers. Publish requires explicit acknowledgement when warnings exist. Blocking issues cannot be acknowledged away.

## Validation

`RosterService` + `validateRosterDraft` re-query authoritative rows. Client-supplied statuses and user IDs are ignored.

Blockers include:

- run not in `OPEN` / `ROSTERING` / `PUBLISHED` (including frozen `IN_PROGRESS` / `COMPLETED`)
- withdrawn selection
- inactive character
- lockout conflict (`LockoutService`, same reset as signup)
- booster access no longer approved (`BoosterAccessService` — signup-time approval is not enough; revoke is a publish blocker)

See [booster-access-management.md](booster-access-management.md).
- two selected signups for one user

Warnings: composition under or over target.

Signup-time eligibility can rot before publish. Access and lockouts are therefore re-checked at publish.

## Publication

Explicit **Publish Roster** action (never a checkbox).

In one database transaction:

1. Draft-selected signups → `SELECTED`
2. Other non-withdrawn candidates → `NOT_SELECTED`
3. `WITHDRAWN` stays `WITHDRAWN`
4. Run `OPEN` → `ROSTERING` → `PUBLISHED`, or `ROSTERING` → `PUBLISHED`
5. Roster `state = PUBLISHED`, `version++`, `publishedAt`, `publishedById`
6. Activity `ROSTER_PUBLISHED` (first time) or `ROSTER_UPDATED` (republish)

Self-withdrawal of a `SELECTED` signup on a `PUBLISHED` run remains forbidden (Phase 2 rule).

A published run may still receive **new** `PENDING` signups if `signupsOpen` and run status allow it. Those wait for a later republish.

## Republish

**Edit Published Roster** copies current `SELECTED` signups into the draft when the draft is still empty (`version === 1` and no entries). It does **not** revert signup statuses.

The published roster stays live until a replacement publish succeeds. The lead may add a newly arrived `PENDING` offer, drop someone, and republish.

`IN_PROGRESS` and `COMPLETED` runs reject draft mutation, publish, and republish. See [run-lifecycle-attendance.md](run-lifecycle-attendance.md).

## Security

- Current user comes from the session, not the client body
- `requireManagerOrRedirect` gates `/manage` and `/manage/runs`
- Canonical Run detail is `/runs/[runId]`; manager payload is omitted unless `canManageRun`
- `assertCanManageRun` gates every roster read/mutation
- Zod validates run/signup IDs and version only — not statuses or ownership
- Publish re-reads DB state and checks `version`

## MVCS

| Layer | Roster pieces |
| --- | --- |
| Model | `RunRoster`, `RunRosterEntry`, `RosterState` |
| View | `/manage/runs`, `/runs/[runId]` Roster tab, `roster-builder.tsx`. `/manage/runs/[runId]` redirects. |
| Controller | `managementController.getRosterPage`, `toggleRosterDraftSelectionAction`, `prepareRosterEditAction`, `validateRosterAction`, `publishRosterAction` |
| Service | `RosterService`, `roster-composition`, `roster-validation`, plus `Run` / signup / access / lockout helpers |
| Repository | `RosterRepository` (Prisma stays here) |

## Deferred

- Raid groups 1–8, parties, markers, assignments
- Payouts / gold
- Battle.net, Warcraft Logs, Discord bot, notifications
- Customer bookings / boost market
- Per-user timezones
