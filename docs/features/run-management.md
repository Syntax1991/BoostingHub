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

**One canonical workflow, 1–25 drafts.** Route: `/runs/create` (operational Runs hub). There is no separate "single create" vs. "mass create" UI — the same page and the same server action handle a Raid Lead preparing one Run for tonight and an Admin preparing a whole week at once. Same authorization as every other manager action (`RAID_LEAD`/`ADMIN`, enforced server-side regardless of navigation). Legacy `/manage/runs/create` and `/manage/runs/create-many` redirect here.

**Creation products** (not raw Raid rows): `VENOMOUS_ABYSS` (1–8 bosses) and `MIDNIGHT_S2_BUNDLE` (Tide 1/1 + Venomous 1–8). Standalone Tidebound is never offered. Each draft persists authoritative `RunRaidContent` rows only — there is no singular `Run.raidId` / `Run.plannedBossCount` mirror.

**Model**: shared defaults (product/preset, difficulty, loot type, raid lead, composition, Venomous planned boss count, notes) + one row per concrete run, each with its own required `scheduledStartAt` and optional per-field overrides, submitted once. The page starts with exactly one staged row — the ordinary one-off experience — and a manager only sees more than one if they explicitly click Add Run or Duplicate. This is a convenience for preparing concrete runs — **not** a recurrence engine; there is no weekly/RRULE templating or scheduled-generation job, and each row is one specific run a manager already has in mind.

**Bounds**: 1–25 runs per request, enforced client-side for UX and authoritatively server-side (`createManyRunsSchema`). 0 or 26+ rows are rejected with a clear message, never silently truncated.

**Shared preparation path**: `run.service.ts` extracts `resolveRequestedRaidLeadId` (RAID_LEAD self-only vs ADMIN-must-choose) and `prepareRunDraft` (schedule/composition/loot-type/boss-count validation + server title derivation via `buildRunTitle`) into functions `createManyRuns` uses for every row — a 1-row submission and a 25-row submission both flow through the exact same `createManyRuns` → `prepareRunDraft` path, never a forked implementation for the "single" case. `title` is never accepted from the client. (`runService.createRun`/`getCreateForm` — the original single-Run methods — still exist and are exercised directly by the Service-level test suite, but no product UI calls them anymore; the canonical page always uses the generalized action, even for one row.)

**Row overrides**: every field is "override present → use it, else inherit the shared default" except `notes`, which is three-valued: override key absent → inherit shared notes; override `null` → explicitly clear this row's notes even though a shared value exists; override a string → use it. A row overriding `raidId` or `difficulty` is validated against *that row's own* effective raid/difficulty — `plannedBossCount`, for example, is checked against the overridden raid's real boss total, never the shared default raid's.

**Batched lookups**: raid and eligible-raid-lead resolution are each one query for the whole batch (`raidRepository.listByIds`, `userRepository.listEligibleRaidLeads`), not one query per row — the maximum is only 25, but this avoids an obvious N+1 regardless.

**Validate everything, then write once**: every row is fully merged and validated before any persistence is attempted. The first invalid row aborts the whole submission with `Run <n>: <reason>` (1-based, matching the row's position in the request) — including reusing `RAID_NOT_AVAILABLE_FOR_RUNS` when any row (via defaults or an override) targets a raid with `availableForRuns: false` (see [§ Historical raid availability](#historical-raid-availability)).

**Atomicity**: `runRepository.createManyDraftsAtomic` persists every row's `Run` + `RunRaidContent` set and its initial empty `RunRoster` inside one database transaction — genuinely all-or-nothing, whether the request has 1 row or 25. A fault partway through (e.g. invalid content `raidId` on a later row) rolls back every row already written in that same call, never leaving a partial result.

**Result**: every created run is `DRAFT`, `signupsOpen: false`, not archived. No Discord infrastructure is touched (no `RunDiscordPost`, no channel, no message) — a fresh Draft is invisible to `discordSyncService.listSyncWork()` until it is opened normally, one Run at a time, from Manage Runs or the run's own page. Creation never shortcuts opening or publishing.

**Activity**: one summary `RUN_CREATED` Activity row per successful submission ("Created N run draft(s)."), never one row per created run.

**Legacy URLs**: `/manage/runs/create` and `/manage/runs/create-many` redirect to `/runs/create` rather than rendering a second form, so old links/bookmarks still work.

**After success**: one draft navigates to its canonical detail (`/runs/[runId]`); multiple drafts navigate to `/manage/runs?massCreated=N` so every new DRAFT is visible under Manage Runs. Cancel returns to `/runs`.

**Templates**: a Raid Lead may optionally apply a saved Venomous-only planning preset from the template selector above Shared Defaults. Bundle templates are intentionally not supported — Create/Mass Create still offer Season 2 Bundle via `contentPreset`. Applying a template expands to `contentPreset: VENOMOUS_ABYSS` + `venomousPlannedBossCount` and locks the effective Raid Lead to the template's owner. The server always re-resolves the template fresh at submit time and rejects a forged Raid Lead override. See [run-templates.md](run-templates.md).

## Derived identity (title, loot type, boss coverage)

There is no title input on Create or Edit — `Run.title` is always server-derived from the schedule, difficulty, loot type, content coverage token (`titleCoverage` from `projectRunContentDisplay`), and raid lead. See [domain-model.md § Run](../domain-model.md#run) for the full format, the `RunLootType` compatibility matrix (`MYTHIC + SAVED` rejected), and how Discord channel naming reuses the same structured coverage projection. Creation (above) reuses this exact same structured validation and title-generation path per row, never a duplicate implementation.

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

| Status | Raid / difficulty / content / bosses | Schedule / loot / composition / notes / role ping | Raid lead reassignment |
| --- | --- | --- | --- |
| `DRAFT` | Editable | Editable | ADMIN only |
| `OPEN` (with or without signups) | Editable | Editable | ADMIN only |
| `ROSTERING` | Editable | Editable | ADMIN only |
| `PUBLISHED` | Editable | Editable | ADMIN only |
| `IN_PROGRESS` | Locked | Locked | Locked |
| `COMPLETED` | Locked | Locked | Locked |
| `CANCELLED` | Locked | Locked | Locked |

The rule is a single predicate, `canEditRunBeforeStart(status)` (`PRE_START_RUN_STATUSES`): a Run is editable until **Start Run**. Edit Run is available in `PUBLISHED` too. Server-side every edit returns `RUN_EDIT_LOCKED` once the Run has started, independent of what the UI showed. `MYTHIC` + `SAVED` stays invalid.

## Signup history does not freeze the Run

Existing signups (including `WITHDRAWN`) no longer lock raid / content / difficulty. Changing them keeps every signup, offered role and the saved/published selection; nothing is silently deleted or auto-deselected. Eligibility (Booster Access for the **current** difficulty, lockouts, reservations, schedule conflicts, composition) is recalculated from the current Run state everywhere it is evaluated — roster builder, Update / Publish Roster, Add Booster and Start. Example: a Normal-only Booster selected for a Normal Run stays selected after the Run is changed to Heroic, but the roster shows the Booster Access blocker, Update Roster refuses the invalid lineup and Start is blocked until the lead replaces the player and updates the roster.

**Roster acknowledgement.** When a roster was already published, a roster-relevant edit — difficulty, raid content, planned boss count, schedule, loot type, or desired Tank/Healer/DPS counts — sets `RunRoster.runChangedSinceAck = true` in the same transaction. The published roster then shows "Run details changed since the roster was last published" and counts as having unpublished changes, so Start is refused until **Update Roster** (or the first Publish) acknowledges the change and clears the flag. Notes, the Discord role-ping flag and Raid Lead reassignment do not set it. Before the first publish nothing is set — the first Publish validates the current Run anyway.

**Edit vs Start.** The Run edit transaction (`runRepository.updatePreStartAtomic`) locks the `RunRoster` row first — the same lock order as roster writes and Start — then re-reads the Run and refuses unless it is still pre-start. An edit that commits before Start marks the roster changed (Start then refuses); an edit that waits behind Start fails with `RUN_EDIT_LOCKED` and changes nothing.

## Raid lead reassignment

- `RAID_LEAD` cannot reassign their run.
- `ADMIN` may reassign throughout the pre-start lifecycle: `DRAFT`, `OPEN`, `ROSTERING` and `PUBLISHED`. Locked from `IN_PROGRESS`.
- Target must be an eligible active `RAID_LEAD` or `ADMIN`.
- Reassignment changes who may manage the run and is enforced in `RunService`. It does not mark the roster changed; the roster version is bumped so the current Discord roster post (whose title names the Raid Lead) is refreshed in place.

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

`/manage/runs` is the managerial index for **existing** Runs (not the home of creation):

- content, difficulty, schedule, raid lead, status, signup window, signup count, roster state
- filters: status, upcoming/past, raid lead (admin)
- empty state: “No runs created yet.”
- row actions open canonical `/runs/[runId]`

**Create Run** lives on `/runs` (header action for RAID_LEAD/ADMIN) and opens `/runs/create`.

## Visibility

- **DRAFT** is management-only. `/runs` does not list drafts. USER detail access returns not found. Assigned raid lead and ADMIN may open the draft.
- **CANCELLED** is excluded from signup-oriented discovery. Canonical detail remains for managers and for users with historical participation. My Runs may still show cancelled participation.

## Raid reference data

Supported raid content lives in `src/lib/wow-raid-catalog.ts` and is upserted by `raidRepository.ensureReferenceRaids()`.

This is **system/reference WoW content**, not demo users or demo Runs. The catalog uses stable identifiers. Dev seed still creates fixture users and example Runs around that content. Run services and UI do not hard-code demo Run IDs.

`ensureReferenceRaids()` is idempotent and is invoked from seed and from Run create/edit option loading so a production install without demo Runs can still create Runs.

### Historical raid availability

A raid is never deleted when a new content tier replaces it — its `Raid`/`RaidBoss` rows, and every historical Run/lockout relation pointing at it, stay intact and fully readable forever. What changes is whether it can be picked for a **new** Run.

`WowRaidCatalogEntry.availableForRuns` (mapped by `ensureReferenceRaids()` onto the `Raid.isActive` column — no separate column, no migration) is the single source of truth, exposed as `RaidRecord.availableForRuns` and read exclusively through `raidRepository.listAvailableForRuns()` (available raids only) / `raidRepository.findById()` (any raid, including historical). Views never infer availability themselves.

This is a **distinct concept from `currentForLockouts`** (`src/lib/wow-raid-catalog.ts`), which only tells Blizzard lockout derivation which raid's encounters to track. Manaforge Omega is `currentForLockouts: false` (superseded) *and* `availableForRuns: false` (historical) today, but the two flags are independent and neither is ever derived from the other — a future raid could in principle be current for lockouts without being open for new Run creation, or vice versa.

Where availability is enforced:

- **Creation** (`getCreateManyForm`, `createManyRuns`, and every row of a batch): the raid picker only lists available raids; the server independently re-validates on submit and rejects an unavailable raid with `RAID_NOT_AVAILABLE_FOR_RUNS` ("This raid is no longer available for new runs.").
- **Edit Run** (`updateRun`): only rejected when the raid is *actually changing* to a different, unavailable one. Keeping an existing (possibly historical) raid — including a difficulty-only change on that same raid, or any unrelated field edit — is never blocked by availability; that is a completely separate concern from the signup-history identity lock above. The Edit Run raid selector always represents the Run's current raid as its selected value (marked "(Historical)" and non-selectable as a fresh alternative when historical) without offering any other historical raid as a replacement.
- **Open Run**: never re-checks raid availability — opening progresses an already-established reference, not a new selection, so a Draft created before a raid became historical can still be opened.

Historical Run reads (`/runs/[runId]`, Discord/embed DTOs, etc.) are unaffected — they resolve the raid by its stable id regardless of availability.

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
- Wallets / extra organizational cuts (completed-run settlement is in [run-payouts.md](run-payouts.md))
- Battle.net / Blizzard
- Warcraft Logs
- Discord/email notifications (activity events exist for later use)
- Destructive Run delete
