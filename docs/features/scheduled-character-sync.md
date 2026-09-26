# Scheduled Blizzard character sync

## Purpose

Blizzard profile data and current-raid lockouts on an already-linked Character drift out of date between manual refreshes. This feature adds an automatic background refresh for every stale, active Character — linked ones VERIFIED through the owner's connection, manual ones PUBLIC by realm + name (see [blizzard-integration.md](blizzard-integration.md)) — without the app owning a recurring timer.

It reuses the exact same lower-level refresh logic as manual "Refresh" / "Refresh All" (`character-blizzard-sync.service.ts`): profile fetch/validate/apply, optional Raider.IO equipped-ilvl raise when higher than Blizzard, monotonic item-level (never decreases below the stored peak), current-raid lockout sync, identity/realm-transfer safety checks, and the "missing item level never clears the existing one" guarantee. This feature only adds the *orchestration* around calling that logic for many Characters, globally, on a schedule it does not itself keep.

## One-shot architecture — no internal timer

**The app never owns the external scheduler cadence.** There is no `setInterval`, no recursive `setTimeout`, no `while (true)` loop, and no cron library daemon anywhere in this feature. Instead:

```text
External scheduler (cron / Windows Task Scheduler / CI schedule / ...)
  → npm run sync:characters   (one process invocation)
    → scheduledCharacterSyncService.runOnce()   (one sync cycle)
    → process exits
```

One invocation performs exactly one cycle, then the process exits with a status code. Scheduling the next tick is entirely an infrastructure concern, external to this codebase.

This is a deliberate difference from the Discord bot (`src/discord-bot/`), which *is* a long-lived process — the scheduled sync script is not, and must not be run from inside the bot process or a Next.js API route with its own timer.

## Scheduler cadence vs stale threshold

These are **separate** concepts:

| Concept | Recommended value | Who owns it |
| --- | --- | --- |
| External scheduler tick | ~every **15 minutes** | Infrastructure (cron / Task Scheduler) |
| Character stale threshold | **120 minutes** (2 hours) | Application (`BLIZZARD_SYNC_STALE_MINUTES`) |

Why both:

- The scheduler runs often enough that a failed or rate-limited Character can retry on the next tick without waiting another two hours.
- The stale filter skips Characters that were successfully synced within the last two hours, so most 15-minute ticks find **zero** candidates and make **no** Blizzard requests.
- Successful Characters therefore synchronize about every two hours under normal conditions.

Example timeline:

```text
12:00  Character successfully synced
12:15  scheduler runs → Character fresh → skipped (no Blizzard call)
12:30  …skipped…
…
14:00  Character is stale → sync candidate → Blizzard refresh
14:00  (if that refresh fails) Character remains stale
14:15  scheduler runs → still stale → eligible again
```

Do **not** configure the external scheduler to run only once every two hours — that would delay retries after transient Blizzard failures.

## Command

```bash
npm run sync:characters
```

```bash
npm run sync:characters -- --dry-run
```

`--dry-run` acquires the same advisory lock (so it can't race a real cycle), counts eligible candidates, and prints a summary — it makes **no** Blizzard API calls and **no** database writes. Use it once before the first real run against production data to sanity-check candidate scope (how many Characters, users, connections, and which regions).

Exit code `0`: completed (including "no candidates" and "another cycle already running"). Non-zero: invalid configuration (e.g. Battle.net not configured) or an unrecoverable infrastructure error.

## Stale threshold

```ts
const DEFAULT_STALE_MINUTES = 120; // BLIZZARD_SYNC_STALE_MINUTES
```

Configurable via `BLIZZARD_SYNC_STALE_MINUTES` (see `.env.example`):

- Unset → defaults to **120 minutes** (2 hours).
- Set to a positive integer → used as-is (e.g. `15`, `30`, `120`).
- Set to anything else (zero, negative, fractional, non-numeric) → the job fails loudly (`resolveScheduledSyncStaleMs()` throws) rather than silently falling back or permitting a 0-minute busy-loop threshold. A misconfigured production value should be visible, not quietly hammer Blizzard every cycle.

Production recommendation:

```env
BLIZZARD_SYNC_STALE_MINUTES=120
```

A Character with `lastSyncedAt === null` is always stale and eligible.

### Boundary comparison

Eligibility uses a strict `<` against `staleBefore = now - threshold`:

- `lastSyncedAt < staleBefore` → stale (candidate)
- `lastSyncedAt === staleBefore` → fresh (skipped)
- `lastSyncedAt > staleBefore` → fresh (skipped)

So at an exact two-hour boundary the Character is treated as still fresh.

## Candidate selection

A Character is a sync candidate only if **all** of:

- `isActive === true`
- `blizzardCharacterId` and `blizzardRealmId` are both set (linked to Battle.net)
- its owner has a `BattleNetConnection` for that Character's own `region`
- it is stale per the threshold above

`characterRepository.listScheduledSyncCandidates({ staleBefore })` implements this as two bounded queries, regardless of how many Characters or Users exist:

1. One `Character` scan filtered to `isActive` + both Blizzard ids present, with the owning `User` eager-loaded (`.include("user")`) for attribution. Staleness itself is filtered in-process, because the ORM's public field-proxy API has no OR combinator to express "`lastSyncedAt` is null or older than X" as one predicate.
2. One batched `BattleNetConnection` lookup (`.where((c) => c.userId.in([...]))`) across the distinct owner ids from step 1, joined in-memory by `${userId}:${region}`.

This is never a User → Character → connection N+1 scan.

## Global concurrency

At most **4** Character refreshes run at once, globally — not 4 per User, per region, or per connection. Enforced by the shared `mapWithConcurrency` helper (`src/lib/concurrency.ts`), the same round-robin worker pool manual "Refresh All" uses (`REFRESH_ALL_CONCURRENCY`). If 30 Characters across many Users/regions are eligible, still only 4 are ever in flight.

## Overlap protection

If the external scheduler starts a new cycle while a prior one is still running (e.g. a slow cycle overruns the ~15-minute tick), the second invocation must not perform another full sync.

Implemented with a PostgreSQL **session-level advisory lock** (`scheduledJobLockRepository`, `src/repositories/scheduled-job-lock.repository.ts`) using `pg_try_advisory_lock` / `pg_advisory_unlock` on a stable, documented key pair: `(837462, 1)`. Session-level locks are bound to the physical backend connection, not to a query — so the repository acquires a dedicated client from the shared `pgPool`, holds that *same* client for the full job, and releases the lock on that same client before returning it to the pool. It never acquires through one pooled query and assumes another connection owns the lock.

If the lock cannot be acquired, `runOnce()` returns `{ status: "SKIPPED_ALREADY_RUNNING" }` immediately — no Blizzard calls, no candidate loading, no mutations — and the script exits `0`. An expected overlap is not a process failure.

## Data ownership

Scheduled sync **may** update, per successfully-refreshed Character:

- `Character.name`, `normalizedName`
- `Character.itemLevel` (only when Blizzard supplies one — see below)
- `Character.lastSyncedAt`
- the sync telemetry fields (`lastSyncAttemptAt`, `lastSyncErrorAt`, `lastSyncErrorCode`, `syncFailureCount`) — for every attempt, successful or failed
- current-raid `CharacterRaidLockout` rows
- `BattleNetConnection.lastSuccessfulSyncAt` (grouped — see below)

Scheduled sync **never** updates `Character.specialization` or `Character.primaryRole` — those are Character metadata a Blizzard sync must not overwrite (only the User editing the Character changes them). Item level may still be raised from Raider.IO after the Blizzard apply when that source reports a higher equipped value (same soft enrichment as manual Refresh). It also never calls `applyBlizzardLink()` (the initial-link path); it only ever calls `applyBlizzardSync()`, same as manual refresh — a PUBLIC sync never stamps Blizzard ids.

It also never changes Weekly Availability, Booster Access / Qualification, signup/roster/run commitments, payout, or attendance data.

### Partial failure policy

One broken Character (profile unavailable, character deleted server-side, identity/class mismatch, realm transfer, transient Blizzard error) does not fail the job. It is counted in `failed` (a Blizzard status/profile 404 additionally in `profileUnavailable` — see [blizzard-integration.md](blizzard-integration.md)) and the cycle continues with the remaining candidates. On any such failure, the Character's existing `itemLevel` and lockout rows are left untouched — never cleared to `0`/`null`/empty. A failed Character remains stale and is eligible again on the next external scheduler tick.

### Lockout sync failure

If the profile refresh succeeds but the lockout-encounters call fails or is unusable, the profile fields (`name`, `itemLevel`, `lastSyncedAt`) still update and the *prior* lockout rows are preserved untouched — the Character is counted in `lockoutsUnavailable`, not `failed`.

### Rate limiting

If Blizzard returns `BATTLENET_RATE_LIMITED` for any candidate, the job stops dispatching *new* refreshes for the remainder of the cycle (already-in-flight requests are left to settle) rather than retrying into the rate limit. Every candidate that hit the limit or was skipped because of it is counted in `rateLimited`, and the cycle still exits cleanly and reports its result — no retry storm, no long in-process sleep (the current Blizzard API client does not expose a trustworthy `Retry-After` contract to sleep against, so the deliberate, documented choice is to stop the cycle conservatively instead).

Because the external scheduler runs again approximately 15 minutes later, still-stale Characters naturally become candidates again without an in-process retry loop.

### Configuration failure

If Battle.net credentials are globally missing (`BATTLENET_NOT_CONFIGURED`) and there is at least one candidate, the job fails fast — before issuing any Blizzard calls — instead of reporting every candidate as an individual failure. The script exits non-zero with a clear message and never logs the credential values themselves.

### Connection sync timestamp

Successful refreshes are grouped by `BattleNetConnection`. A connection's `lastSuccessfulSyncAt` is marked **once per cycle** if at least one of its Characters refreshed successfully — never once per Character, and never at all if every Character for that connection failed.

## Relationship to manual refresh

Manual refresh (`characterBlizzardSyncService.refreshCharacter` / `refreshLinkedCharactersForRegion`) keeps its **60-second** `REFRESH_COOLDOWN_MS`, measured from `lastSyncAttemptAt` — the start of the latest attempt, successful or failed — so a failing Character cannot be retried every second. "Refresh All" is still available from the Web UI.

The scheduled job's **120-minute** stale threshold is a completely separate concept from the manual cooldown:

- Background: last sync 45 minutes ago → considered fresh → scheduler skips.
- User presses Refresh → existing manual path may refresh immediately (subject to the ~60-second manual cooldown only).

Do not share configuration between these two paths.

Both paths call the same `syncLinkedCharacterProfile(owner, character, connectionId, options)` entry point, which owns the per-Character lock and the sync telemetry (see [blizzard-integration.md § Sync telemetry](blizzard-integration.md#sync-telemetry)). The job never selects candidates by `lastSyncAttemptAt` — freshness stays success-based, so a failing Character remains a candidate every tick. A candidate already being synced elsewhere (per-Character lock held) is skipped without an attempt and counted in `skippedInProgress`. It takes a minimal `CharacterSyncOwner = { id, name }` context rather than a full `AuthenticatedUser`, because the scheduled job has no logged-in User — it builds this context from the Character's real, persisted owner (via the eager-loaded `User` relation), never a fabricated `ADMIN` user or a bypassed ownership check.

## Activity logging

Routine scheduled sync writes **no** `ActivityEvent` rows — not one per Character, and not one per cycle. `refreshLinkedCharacterProfile` is always called with `writeActivity: false` and `updateConnectionSync: false` from the scheduled job (the connection timestamp is instead marked once per connection by the orchestration service itself, as described above). Operational results go to process/console logging (`console.info`/`console.error`), one summary line per cycle, exactly like the script's own printed summary.

## Relationship to informational raid saves

Raid lockouts are informational only, never a signup blocker (see [run-signups.md](run-signups.md)). Scheduled sync will make lockout data fresher — e.g. turning `HC 1/8` into `HC 8/8` between manual refreshes — but this can never, by itself, make a Character ineligible for a signup. `CHARACTER_ALREADY_SELECTED_OTHER_RUN` (cross-run Character reservation) is a separate, unrelated, still hard-blocking rule that this feature does not touch.

## No schema migration

No `ScheduledJob` / `CronJob` / job-lease table was added. A PostgreSQL advisory lock is sufficient for overlap protection and requires no persistent state or migration.

## Scheduling examples

Recommend an external tick of **~15 minutes** even though Characters only become stale after **120 minutes**. Most ticks should exit quickly with zero candidates.

The application still owns **no** timer. Installing an external scheduler (below) does not add `setInterval`, cron-inside-Next.js, or a Discord-bot loop — it only registers infrastructure that invokes the existing one-shot command.

### Manual Windows Task Scheduler

- **Program/script**: `powershell.exe`
- **Add arguments**: `-NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\path\to\checkout'; npm run sync:characters"`
- **Start in**: your local checkout root (must contain `package.json` and `.env`)
- **Trigger**: repeat every **15 minutes** (not every 2 hours)

### cron (generic Linux/macOS deployment)

```cron
*/15 * * * * cd /path/to/boostinghub && npm run sync:characters >> /var/log/boostinghub-sync.log 2>&1
```

Replace the path with wherever the app is deployed; nothing here should reference a specific machine's real path or credentials. Hosting-provider scheduled jobs / CI schedules are also valid externals — same one-shot command.
