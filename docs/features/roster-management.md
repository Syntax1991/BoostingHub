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

## One user rule (Booster-specific)

**At most one selected BOOSTER participation per user per run.**

Selecting a second BOOSTER signup for the same user **replaces** the previous BOOSTER draft row. Silent double booster slots are forbidden. The service enforces this; the database cannot, because the path is `RunRosterEntry → RunSignup.userId`.

The same User **may** hold one selected BOOSTER **plus** any number of selected LOOTBUDDY rows. Lootbuddy selections are never collapsed by `userId`.

If one BOOSTER character is `SELECTED`, the user's other active BOOSTER offers on that run become `NOT_SELECTED` on publish. Lootbuddy rows are decided independently per `RunSignup.id`.

## Composition

Targets come from the run (`desiredTankCount`, `desiredHealerCount`, `desiredDpsCount`), never hardcoded 2/4/14.

- Booster `TANK` / `HEALER` / `DPS` count toward those slots
- Lootbuddies (`LOOT_ONLY` and `PLAYING`) do **not** count as booster composition
- `PLAYING` has no assigned booster role, so it stays in the lootbuddy bucket

Mismatch is a **warning**, not an automatic hard block. A lead may draft 5/4 healers. Publish requires explicit acknowledgement when warnings exist. Blocking issues cannot be acknowledged away.

## Class Buff Checker

Derived composition helper on the Roster Builder (informational — never a publish blocker).

- **Source of truth:** current **draft** selection (`RunRosterEntry.selected === true`), not every signup.
- **Booster:** counts by `character.wowClass` when selected.
- **PLAYING Lootbuddy:** counts by `lootbuddyClass ?? character?.wowClass` when selected (includes legacy Character-backed rows).
- **LOOT_ONLY Lootbuddy:** never counts, even when selected.
- **Duplicates:** multiple Mages still cover Arcane Intellect once; provider detail retains every `signupId`.
- **Meaning:** class *availability* in the selected composition — not live aura cast / talent verification.
- **No persistence:** coverage is computed by `evaluateRaidBuffCoverage` in `roster-raid-buffs.ts`. No coverage tables or stored counts.

Tracked set (Midnight Season 2): Arcane Intellect, Power Word: Fortitude, Battle Shout, Mark of the Wild, Skyfury, Devotion Aura, Blessing of the Bronze, Chaos Brand, Mystic Touch.

## Validation

`RosterService` + `validateRosterDraft` re-query authoritative rows. Client-supplied statuses and user IDs are ignored.

Blockers include:

- run not in `OPEN` / `ROSTERING` / `PUBLISHED` (including frozen `IN_PROGRESS` / `COMPLETED`)
- withdrawn selection
- inactive Character (BOOSTER and legacy Character-backed LOOTBUDDY only — characterless Lootbuddy is not inactive)
- booster qualification no longer approved (`BoosterQualificationService` — User + Run Difficulty; revoke is a publish blocker)
- two selected **BOOSTER** signups for one user

Raid lockouts remain informational only — never a publish blocker.
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
- Wallets / extra organizational cuts (see [run-payouts.md](run-payouts.md))
- Battle.net, Warcraft Logs, Discord bot, notifications
- Customer bookings / boost market
- Per-user timezones
