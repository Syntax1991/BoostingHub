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
| `MATERIALIZED` | Run created for this occurrence from the Run Setup (hourly auto-create, immediate auto-create after save, or manual **Create Run**) |
| `ATTACHED` | an existing, independently created Run adopted as this occurrence (**Use existing Run**) — provenance only, nothing is copied |

Both share the same unique constraints, so a materializer pass and an attach racing for the same occurrence end with
exactly one fulfillment (the loser rolls back / gets *already fulfilled*).

## Start boundary

`CommunityScheduleSlot.firstWindowStartAt` (nullable): raid-ID window of the first occurrence the materializer may
create. `null` = active immediately (legacy behavior). Occurrences in earlier windows are never auto-created (manual
**Create Run** is refused with *not started*); the Schedule view shows them as **Not started yet** with the start date.

**Starts** choices (resolved server-side from `now`, never stored as browser-local datetimes):

| choice | boundary |
| --- | --- |
| Immediately | `null` |
| Next raid ID | the next raid ID (skips a still-upcoming occurrence of the current one) |
| Skip the next occurrence | the raid ID after the first upcoming occurrence |
| From date… | raid ID of the first occurrence starting on/after that Berlin calendar day |

A boundary at or before the first upcoming occurrence is stored as `null`. Changing the start (Edit → Starts; default
**Keep**) only affects future, not-yet-fulfilled occurrences; existing Runs and links are never touched.

## Use existing Run

- **Create Schedule / Add times**: per weekly time, **First occurrence** = *Per schedule* or *Use existing Run · …*.
  The link is written in the same transaction as the slot, before the immediate auto-create can claim the occurrence.
- **Schedule view**: **Use existing Run** on any upcoming, unfulfilled occurrence (including *Not started yet*).

One service (`community-schedule-occurrence.service.ts`, `attachExistingRunInTx`) backs both. Eligible Runs: not
archived, `DRAFT` / `OPEN` / `ROSTERING` / `PUBLISHED`, not linked to any occurrence, start inside a current or future
raid ID. The occurrence is the slot's occurrence in the **Run's** raid ID. Differences are warnings only (start time,
difficulty, raid scope vs the Run Setup, Raid Lead) — the Run keeps its own values; later occurrences still use the Run
Setup. Attaching records a `RUN_SCHEDULE_ATTACHED` RunDomainEvent. Detach is not offered (first iteration).
