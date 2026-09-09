# Run lifecycle and attendance

## Purpose

Operational Run completion after roster publication:

`PUBLISHED` → `IN_PROGRESS` → `COMPLETED`

Assigned raid leads and admins start a published Run, record who actually attended, and complete the Run only when every attendance row is marked.

This is not payout, Warcraft Logs, Blizzard, Discord notifications, or analytics.

## Lifecycle

Roster Management still owns `OPEN → ROSTERING` and publication to `PUBLISHED`.

This feature owns:

- `PUBLISHED → IN_PROGRESS` via **Start Run**
- `IN_PROGRESS → COMPLETED` via **Complete Run**

There is no generic `RunStatus` dropdown.

Cancellation before start remains Run Management policy (`DRAFT` / `OPEN` / `ROSTERING` / `PUBLISHED`). Ordinary cancellation from `IN_PROGRESS` is still not offered.

## Start Preconditions

The server re-reads authoritative state. Start requires:

- the Run exists
- `Run.status === PUBLISHED`
- the caller can manage the Run (`canManageRun`)
- a published roster exists (`publishedAt`)
- at least one currently `SELECTED` participant

Scheduled start time is **not** a blocker. Runs may start early or late.

## Roster Freeze

Once the Run is `IN_PROGRESS` (and after `COMPLETED`):

- draft selection is rejected
- publish / republish is rejected
- published-roster seed-for-edit is rejected

Attendance is the roster that entered the Run. Later roster edits cannot silently rewrite attendance rows.

`PUBLISHED` roster editing before Start is unchanged.

## Attendance Snapshot

Start is transactional. It either:

1. creates one `RunAttendance` row per currently `SELECTED` published participant
2. sets `signupsOpen = false`
3. sets `status = IN_PROGRESS`

or it writes nothing.

Initial status is `UNMARKED`. Nobody is auto-marked `PRESENT`.

Source of truth is live `SELECTED` `RunSignup` rows on a published roster, linked to `RunRosterEntry` (created if a seed/published snapshot is missing the matching entry). `PENDING` / `NOT_SELECTED` / `WITHDRAWN` rows are not snapshotted.

Booster and lootbuddy selected participants are included in the same attendance list.

Double start does not duplicate rows (`rosterEntryId` is unique; a second start is `RUN_ALREADY_STARTED`).

Start does not mutate BoosterAccess, signup history semantics, character ownership, or lockouts.

## Attendance Status Semantics

| Status | Meaning |
| --- | --- |
| `UNMARKED` | Not yet decided. Blocks completion. |
| `PRESENT` | Attended normally. |
| `LATE` | Attended, joined late. |
| `LEFT_EARLY` | Attended, left before expected completion. |
| `NO_SHOW` | Expected, did not attend. |
| `EXCUSED` | Did not attend; absence accepted. |
| `STANDBY` | Rostered as backup/standby and not required to participate. |

A backup that was available but not needed must not be classified as `NO_SHOW`. Use `STANDBY`.

## Backup / Standby Semantics

Signup `isBackup` is player intent, not attendance.

Do **not** auto-assign `STANDBY` because `isBackup = true`. A backup may be used and attend.

The manager UI shows Backup clearly and offers an easy Standby action for those rows. Final status is a manager decision.

## Authorization

| Account | Start / Complete / mutate attendance | View |
| --- | --- | --- |
| `USER` | No | Own attendance row only, without manager notes |
| `RAID_LEAD` | Assigned Run only | Full operational list on assigned Runs |
| `ADMIN` | Any Run | Full operational list |

`canManageRun` remains the ownership check. Capabilities (`canStart`, `canManageAttendance`, `canComplete`) are server-derived.

## Bulk Mark Present

**Mark all unmarked as Present** is a single service/repository operation.

Only `UNMARKED` rows become `PRESENT`. Existing `LATE`, `LEFT_EARLY`, `NO_SHOW`, `EXCUSED`, and `STANDBY` rows are preserved.

Typical workflow: mark exceptions first, then bulk-present the rest.

## Completion Invariant

A Run cannot complete while any attendance row is `UNMARKED`.

The check is transactional. The domain error is `ATTENDANCE_INCOMPLETE` and includes how many unmarked rows remain.

UI copy: “Mark attendance for all rostered participants before completing the run.”

React is not the enforcement boundary.

## Completed Read-Only Policy

On success:

- `status = COMPLETED`
- `signupsOpen = false`
- attendance remains stored and becomes read-only in this feature

Signup, roster, BoosterAccess, and lockout history stay intact. Payouts are a later explicit settlement on the Payout tab; completion does not compute gold.

Post-completion ADMIN attendance corrections are deferred.

## Canonical Run Detail Integration

Attendance lives on `/runs/[runId]` as a fourth tab: Overview, Signups, Roster, Attendance. Payout is a fifth tab after completion; see [run-payouts.md](run-payouts.md).

There is no `/manage/runs/[runId]/attendance` implementation.

### Before start (`PUBLISHED`)

- Manager: “Run has not started yet.” plus **Start Run** (confirmation dialog).
- USER: “Attendance will be available after the run starts.”

Viewing the tab does not create attendance rows.

### In progress

Manager compact table: character, user, class/role, participation type, backup, status, note, actions.

USER: “Your Attendance” for their own row only.

### Completed

Read-only. Manager sees the full list and a compact status summary. USER sees own final status.

## Security / DTO Shaping

`runDetailService` shapes viewer payloads:

- USER: `attendance.manager = null`, `attendance.own` only, capabilities false, no `markedBy` / manager notes
- Manager: full attendance list, notes, lifecycle capabilities

Hiding a loaded manager list in React is not sufficient.

`markedById` is always the authenticated manager. Clients cannot submit `RunStatus`, `markedById`, or ownership.

## MVCS

```text
View → Controller → Service → Repository → Model
```

- `RunService.startRun` / `completeRun` own lifecycle transitions
- `AttendanceService` owns query, status updates, bulk present, completeness
- `attendance.repository` owns transactional snapshot and completion writes
- Controllers (`startRunAction`, `setAttendanceAction`, `markAllPresentAction`, `completeRunAction`) authenticate, validate with Zod, call services, map domain errors, revalidate `/runs/[runId]`

No Prisma in views or controllers. No attendance transition rules in React.

## Deferred

- attendance correction after completion
- wallet / escrow / payment automation
- Discord notifications
- Warcraft Logs
- Blizzard
- analytics
