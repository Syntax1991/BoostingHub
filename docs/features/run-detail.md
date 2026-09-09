# Canonical Run detail

## Purpose

One canonical Run entity view at `/runs/[runId]`.

This is the long-term surface for participant information and, when authorized, Run management. Future Discord/notification links should use this URL, not a management-only path.

## Route Architecture

| Route | Role |
| --- | --- |
| `/runs` | Discovery/list. Cards link to canonical detail. Signup from the list remains. |
| `/runs/[runId]` | Canonical Run entity view |
| `/my-runs` | Current user's participation overview; each row links to canonical detail |
| `/manage` | Global administration entry |
| `/manage/runs` | Manager Run index and create entry. Actions link to `/runs/[runId]` |
| `/manage/runs/new` | Create Run draft |
| `/manage/runs/[runId]` | Compatibility redirect to `/runs/[runId]` |
| `/manage/booster-access` | Global ADMIN BoosterAccess queue (not moved onto a Run) |

Do not maintain a second independent Run detail implementation under `/manage`.

## Permission-Aware View

The shared route does **not** mean a shared payload. `runDetailService.getRunDetail` shapes data per viewer.

### USER

Participant-facing metadata, own signups, and the published roster when one exists.

Must not receive:

- draft selection
- unpublished roster internals
- validation blockers/warnings
- manager mutations
- full attendance list, manager notes, or `markedBy`

Hiding buttons in CSS is not sufficient.

### RAID_LEAD

May manage only assigned runs (`user.id === run.raidLeadId` and account role `RAID_LEAD` or `ADMIN`).

A raid lead viewing another lead's Run is a normal viewer: no manager DTO, no roster tools.

### ADMIN

May manage any Run on the same `/runs/[runId]` route.

## Sections

- **Header** — raid, difficulty, schedule, status, raid lead, signup window, compact composition, server-gated manager actions (edit / open / signup window / cancel / start / complete)
- **Overview** — prepared summary DTO
- **Signups** — own participation for USER; operational signup list for authorized managers
- **Roster** — published roster for USER; existing `RosterBuilderView` for managers
- **Attendance** — own result for USER; operational attendance for authorized managers after Start

## Manager Authorization

`canManageRun` / `assertCanManageRun` remain the single ownership check.

- Raid lead: assigned Runs only
- Admin: all Runs
- Being listed as `raidLeadId` does not grant a `USER` roster tools

Roster mutations stay on existing roster actions. Views do not decide publish/eligibility/lockout rules.

## Data Security

`manager` is `null` for viewers who cannot manage. Published roster members are a separate public snapshot of `SELECTED` signups. Draft selection is never copied into that snapshot.

USER reads call `getPublishedRosterView`, which uses `findByRunId` and **does not** `ensure()` a roster row.

Manager reads still reuse `getRosterManagementView`, which may `ensure()` an empty draft. That does not change `RunStatus`.

## Existing Service Reuse

- `RunService` — run list, create/edit/open/signup window/cancel/start/complete
- `RunDetailService` — viewer DTO orchestration only, including manager capabilities
- `SignupService` — own signups, eligibility, withdraw
- `RosterService` — draft, publish, published snapshot, managed index
- `AttendanceService` — snapshot, status updates, bulk present, completeness

No second roster or signup implementation.

## Future Extensions

Architectural space only (not implemented):

- Post-completion attendance correction
- History analytics
- Payout

## Deferred

- Battle.net / Blizzard API
- Warcraft Logs
- Post-completion attendance corrections
- Payouts / gold
- Discord bot / notifications
