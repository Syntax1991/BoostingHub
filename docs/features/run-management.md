# Run management

## Purpose

Real production Run creation and lifecycle management so raid leads and admins do not depend on seeded Run rows.

```text
RAID_LEAD / ADMIN
  → Create draft
  → Configure
  → Open Run
  → Accept signups
  → Close / reopen signup window
  → Roster through existing Roster Management
  → Publish through existing RosterService
  → Cancel when necessary
```

Canonical entity URL remains `/runs/[runId]`. There is no second Run-management detail page.

## Authorization

| Account | Create | Edit / open / signup window / cancel |
| --- | --- | --- |
| `USER` | No | No |
| `RAID_LEAD` | Yes, only with themselves as raid lead | Assigned runs only |
| `ADMIN` | Yes, may assign an eligible raid lead (`RAID_LEAD` or `ADMIN`) | Any run |

Raid lead identity is taken from the session for `RAID_LEAD`. Client-supplied `raidLeadId` cannot forge another leader. Admin assignment is validated server-side against active management accounts. Ordinary `USER` accounts cannot become raid lead through form data.

Button visibility is not authorization.

## Creation

Route: `/manage/runs/new`. After success, redirect to `/runs/[runId]`.

Defaults:

- `status = DRAFT`
- `signupsOpen = false`
- an empty `RunRoster` row in `DRAFT` state (same as seed runs), so manager detail does not race two `ensure()` inserts

Creation does not open or publish the run. First persisted roster selection still transitions `OPEN → ROSTERING` through Roster Management.

## Run lifecycle responsibilities

| Operation | Owner |
| --- | --- |
| Create draft, edit planning, `DRAFT → OPEN`, signup window, cancel | Run Management (`RunService`) |
| `OPEN → ROSTERING` on first persisted draft selection | Roster Management (`RosterService`) |
| `ROSTERING → PUBLISHED` on publish | Roster Management (`RosterService`) |
| `PUBLISHED → IN_PROGRESS` / `IN_PROGRESS → COMPLETED` | Run lifecycle + attendance (`RunService` + `AttendanceService`) |

Do not send an arbitrary status from the client. Transitions are explicit domain operations.

## Signup window

`RunStatus` is not `signupsOpen`.

A run may be `OPEN` or `ROSTERING` with `signupsOpen = false`. Closing the window does not withdraw signups, change `SELECTED`, delete rows, or alter roster / BoosterAccess.

- **Open Run** (`DRAFT → OPEN`) sets `signupsOpen = true` atomically.
- **Close Signups** / **Reopen Signups** are allowed on `OPEN` and `ROSTERING` only.
- Drafts use **Open Run**, not Reopen.
- `PUBLISHED`, `IN_PROGRESS`, `COMPLETED`, and `CANCELLED` cannot reopen signups.

## Editability matrix

Centralized in `getRunLifecycleCapabilities` (`src/services/run-state.ts`). Views render server flags.

| Status | Raid / difficulty | Schedule / composition / title / notes | Raid lead reassignment |
| --- | --- | --- | --- |
| `DRAFT` | Editable | Editable | ADMIN only |
| `OPEN` before signup history | Editable | Editable | ADMIN only |
| `OPEN` / `ROSTERING` after signup history | Locked | Editable | ADMIN only |
| `PUBLISHED` | Locked | Locked | Locked |
| `IN_PROGRESS` | Locked | Locked | Locked |
| `COMPLETED` | Locked | Locked | Locked |
| `CANCELLED` | Locked | Locked | Locked |

`PUBLISHED` has no generic Edit Run in this feature. Cancellation may still be available.

## Signup-history lock

Once any persisted `RunSignup` row exists for the run, including `WITHDRAWN`, raid/content and difficulty stay immutable.

Reason: historical signup meaning (BoosterAccess, lockouts, eligibility, player expectation) must not be rewritten.

The identity update runs in a transaction and re-checks signup count so a concurrent signup cannot slip in between the check and the write.

## Raid lead reassignment

- `RAID_LEAD` cannot reassign their run.
- `ADMIN` may reassign while `DRAFT`, `OPEN`, or `ROSTERING`.
- Target must be an eligible active `RAID_LEAD` or `ADMIN`.
- Reassignment changes who may manage the run and is enforced in `RunService`.

## Cancellation

Explicit **Cancel Run** with an application confirmation dialog (not `window.confirm`).

Allowed from `DRAFT`, `OPEN`, `ROSTERING`, `PUBLISHED`.

Not allowed from `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`.

Effects:

- `status = CANCELLED`
- `signupsOpen = false`

Preserved: Run row, signups, roster, BoosterAccess, lockouts, activity/history.

There is **no destructive Run delete**, including for drafts.

## Canonical Run detail

Management actions live on `/runs/[runId]`:

- Edit Run
- Open Run
- Close Signups / Reopen Signups
- Cancel Run
- Start Run / Complete Run (see [run-lifecycle-attendance.md](run-lifecycle-attendance.md))

The Run Detail DTO includes server-derived `capabilities`. USER payloads keep `editor` null and capabilities false. USER still sees lifecycle status, signup window, metadata, own participation, and published roster.

## Manage runs

`/manage/runs` is the global index and create entry:

- Create Run
- content, difficulty, schedule, raid lead, status, signup window, signup count, roster state
- filters: status, upcoming/past, raid lead (admin)
- empty state: “No runs created yet.”
- row actions open canonical `/runs/[runId]`

## Visibility

- **DRAFT** is management-only. `/runs` does not list drafts. USER detail access returns not found. Assigned raid lead and ADMIN may open the draft.
- **CANCELLED** is excluded from signup-oriented discovery. Canonical detail remains for managers and for users with historical participation. My Runs may still show cancelled participation.

## Raid reference data

Supported raid content lives in `src/lib/wow-raid-catalog.ts` and is upserted by `raidRepository.ensureReferenceRaids()`.

This is **system/reference WoW content**, not demo users or demo Runs. The catalog uses stable identifiers. Dev seed still creates fixture users and example Runs around that content. Run services and UI do not hard-code demo Run IDs.

`ensureReferenceRaids()` is idempotent and is invoked from seed and from Run create/edit option loading so a production install without demo Runs can still create Runs.

## MVCS

View → Controller → Service → Repository.

- No Prisma in views or controllers
- Editability and transitions live in `run-state.ts` / `RunService`
- Controllers authenticate, validate, call `RunService`, map errors, revalidate

## Security

- Creator / raid-lead identity is server-derived for `RAID_LEAD`
- Admin assignment is validated server-side
- No client-forged `status` or `signupsOpen`
- No cross-run raid-lead mutation
- Signup-history lock uses database state, not a client count
- Domain errors, not raw Prisma/Postgres errors

## Deferred

- Post-completion attendance corrections
- Payouts
- Battle.net / Blizzard
- Warcraft Logs
- Discord/email notifications (activity events exist for later use)
- Destructive Run delete
