# Community Schedule — occurrences, start boundary, existing Runs

Authority (unchanged):

- **Run Setup** (`RunTemplate`) = WHAT + default composition
- **Schedule slot** (`CommunityScheduleSlot`) = WHEN + WHO + optional composition override + **start boundary**
- **Concrete Run** = independent operational snapshot — never rewritten by Schedule, Run Setup, Product or composition changes

## Occurrence identity

One occurrence = **slot + raid-ID window** (`CommunityScheduleRun`, `UNIQUE(scheduleSlotId, windowStartAt)`;
`windowStartAt` = Wednesday 06:00 Europe/Berlin, DST-safe). `runId` is `UNIQUE`, so a Run belongs to at most
one occurrence. An occurrence is fulfilled in one of two ways (`origin`):

| origin | meaning |
| --- | --- |
| `MATERIALIZED` | Run created for this occurrence from the Run Setup (weekly Draft release, or manual **Create Run**) |
| `ATTACHED` | an existing, independently created Run adopted as this occurrence (**Use existing Run**) — provenance only, nothing is copied |

Both share the same unique constraints, so a materializer pass and an attach racing for the same occurrence end with
exactly one fulfillment (the loser rolls back / gets *already fulfilled*).

## Weekly Draft release

Automatic materialization runs **only** at the weekly release: **Monday 12:00 Europe/Berlin**
(`boostinghub-community-schedule.timer`, `OnCalendar=Mon *-*-* 12:00:00 Europe/Berlin`, `Persistent=true`). Each pass
creates the Drafts of the raid ID starting the **following Wednesday 06:00** for every active slot with
*Automatically create weekly Draft* on (`scheduleDraftRelease` / `releasedWindow`). A pass at any other time (catch-up
after downtime, a manual `systemctl start`) targets the same released raid ID — never the one after it — and is
idempotent (one Run per occurrence).

Saving a Schedule (create, add times, edit, enable auto-create, reactivate) **never** creates Runs. An earlier Draft is
created only by the manual **Create Run** (same uniqueness, start boundary and fulfillment checks, origin
`MATERIALIZED`). The Schedule view shows an unfulfilled future occurrence as **Draft planned** with its release time;
if its release already passed (time planned mid-week) it stays without Run until **Create Run**.

## Ownership and cleanup

Only `origin = MATERIALIZED` **and** `Run.status = DRAFT` is Schedule-owned. When an occurrence goes away —
time deleted, deactivated, weekday / time changed, start moved later, Run Setup deleted — every future Schedule-owned
Draft of the affected occurrences is retired in the **same transaction** as the Schedule change: cancelled from DRAFT
and archived (the Cancel + Archive end state; a Draft has no signups / announcement, so nothing is sent), and its
occurrence is freed (link `scheduleSlotId → null`, exactly like slot deletion) so it never blocks a later release.
A `RUN_SCHEDULE_DRAFT_RETIRED` RunDomainEvent is recorded after commit.

Never touched by Schedule edits: Runs that left DRAFT (open / rostering / published / …) and `ATTACHED` Runs —
no status, time, scope, roster or signup change. No replacement Draft is created eagerly (e.g. Friday → Saturday
creates the Saturday Draft only at the next release or via Create Run). The confirmation dialogs list the
consequences (*N scheduled Draft Run(s) will be archived* / *N active Run(s) will remain unchanged* / *Linked existing
Runs will remain unchanged*).

Concurrency: Schedule mutations, attach and Draft materialization all row-lock the slot first
(`communityScheduleRepository.lockInTx`). The materializer re-checks the locked slot (active, same weekday / time,
start boundary) before inserting Run + link, so an edit and a release pass serialize — no orphan Draft, no duplicate.
The retire step re-checks `DRAFT` under the roster lock, so a Draft opened concurrently is left alone.

## Start boundary

`CommunityScheduleSlot.firstWindowStartAt` (nullable): raid-ID window of the first occurrence the materializer may
create. `null` = active immediately (legacy behavior). Occurrences in earlier windows are never auto-created (manual
**Create Run** is refused with *not started*, and they cannot be fulfilled by **Use existing Run** either); the
Schedule view shows them as **Before schedule start** with the start date.

**Starts** choices (resolved server-side from `now`, never stored as browser-local datetimes):

| choice | boundary |
| --- | --- |
| Immediately | `null` |
| Next raid ID | the next raid ID (skips a still-upcoming occurrence of the current one) |
| Skip the next occurrence | the raid ID after the first upcoming occurrence |
| From date… | raid ID of the first occurrence starting on/after that Berlin calendar day |

A boundary at or before the first upcoming occurrence is stored as `null`. Changing the start (Edit → Starts; default
**Keep**) only affects future, not-yet-fulfilled occurrences; existing Runs and links are never touched.

## Start a Schedule from an existing Run (adoption)

**Create Schedule → Start from an existing Run**: picking an upcoming, unlinked Run (eligible as for attach, on/after
the chosen **Starts**) fills the new Schedule from it and attaches it as the first occurrence (`ATTACHED`):

| field | adopted from |
| --- | --- |
| weekday / time | the Run's start in Europe/Berlin (`scheduleTimeOfInstant`) |
| Raid Lead | the Run's Raid Lead — only if still eligible, otherwise the user must choose |
| Run Setup | see below |

Run Setup: a Run has no Run Setup reference (no `RunTemplate` FK; Schedule-created Runs are linked through
`CommunityScheduleRun` and are therefore never attachable again), so there is no provenance to follow. The Run's own
planning snapshot decides: an active, usable Run Setup with **exactly** the same planning fields (difficulty, loot,
ordered `RunRaidContent` incl. boss counts, planned composition) is reused; otherwise **one** new Run Setup is created
from that snapshot (`RunRaidContent` → `RunTemplateRaidContent`, `desired*Count`; never roster / signups, never a
Product guess). One-time copy, no live coupling: later Run edits never change the Setup or Schedule, and Schedule /
Setup edits never change the Run. Run Setup, slot, start boundary and attachment commit in **one transaction**
(`runSetup.mode = "fromRun"`).

Everything stays editable for **future** occurrences (Raid Lead, day / time, Run Setup) — the attached Run keeps its
own time, Raid Lead, scope and roster. **Add times** can take a new time's weekday / time from an existing Run the same
way (Setup and Raid Lead stay those of the group). No Run is created on save (Monday release unchanged).

On an **existing** Schedule, **Use existing Run** attaches only. The Run's Run Setup is used for future occurrences
only with the explicit option *Also use this Run's setup for future occurrences* (Raid Lead and time stay).

## Use existing Run

- **Create Schedule / Add times**: per weekly time, **First occurrence** = *Per schedule* or *Use existing Run · …*.
  The link is written in the same transaction as the slot. The picker only offers occurrences on/after the chosen
  **Starts**.
- **Schedule view**: **Use existing Run** on any upcoming, unfulfilled occurrence on/after the start boundary.
  An occurrence before the boundary is refused with `COMMUNITY_SCHEDULE_NOT_STARTED`.

One service (`community-schedule-occurrence.service.ts`, `attachExistingRunInTx`) backs both. Eligible Runs: not
archived, `DRAFT` / `OPEN` / `ROSTERING` / `PUBLISHED`, not linked to any occurrence, start inside a current or future
raid ID. The occurrence is the slot's occurrence in the **Run's** raid ID. Differences are warnings only (start time,
difficulty, raid scope vs the Run Setup, Raid Lead) — the Run keeps its own values; later occurrences still use the Run
Setup. Attaching records a `RUN_SCHEDULE_ATTACHED` RunDomainEvent. Detach is not offered (first iteration).
