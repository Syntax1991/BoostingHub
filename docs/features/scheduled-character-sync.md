# Scheduled Blizzard character sync

## Purpose

Blizzard profile data and current-raid lockouts on an already-linked Character drift out of date between manual refreshes. This feature adds an automatic background refresh for stale, active, Blizzard-linked Characters — without the app owning a recurring timer.

It reuses the exact same lower-level refresh logic as manual "Refresh" / "Refresh All" (`character-blizzard-sync.service.ts`): profile fetch/validate/apply, current-raid lockout sync, identity/realm-transfer safety checks, and the "missing item level never clears the existing one" guarantee. This feature only adds the *orchestration* around calling that logic for many Characters, globally, on a schedule it does not itself keep.

## One-shot architecture — no internal timer

**The app never owns the ~15-minute cadence.** There is no `setInterval`, no recursive `setTimeout`, no `while (true)` loop, and no cron library daemon anywhere in this feature. Instead:

```text
External scheduler (cron / Windows Task Scheduler / CI schedule / ...)
  → npm run sync:characters   (one process invocation)
    → scheduledCharacterSyncService.runOnce()   (one sync cycle)
    → process exits
```

One invocation performs exactly one cycle, then the process exits with a status code. Scheduling the next tick is entirely an infrastructure concern, external to this codebase.

This is a deliberate difference from the Discord bot (`src/discord-bot/`), which *is* a long-lived process — the scheduled sync script is not, and must not be run from inside the bot process or a Next.js API route with its own timer.

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
const DEFAULT_STALE_MINUTES = 15; // BLIZZARD_SYNC_STALE_MINUTES
```

Configurable via `BLIZZARD_SYNC_STALE_MINUTES` (see `.env.example`):

- Unset → defaults to 15 minutes.
- Set to a positive integer → used as-is.
- Set to anything else (zero, negative, fractional, non-numeric) → the job fails loudly (`resolveScheduledSyncStaleMs()` throws) rather than silently falling back or permitting a 0-minute busy-loop threshold. A misconfigured production value should be visible, not quietly hammer Blizzard every cycle.

A Character with `lastSyncedAt === null` is always stale and eligible.

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
- current-raid `CharacterRaidLockout` rows
- `BattleNetConnection.lastSuccessfulSyncAt` (grouped — see below)

Scheduled sync **never** updates `Character.specialization` or `Character.primaryRole` — those are Character metadata a Blizzard sync must not overwrite (only the User editing the Character changes them). It also never calls `applyBlizzardLink()` (the initial-link path); it only ever calls `applyBlizzardSync()` on already-linked Characters, same as manual refresh.

### Partial failure policy

One broken Character (profile unavailable, character deleted server-side, identity/class mismatch, realm transfer, transient Blizzard error) does not fail the job. It is counted in `failed` and the cycle continues with the remaining candidates. On any such failure, the Character's existing `itemLevel` and lockout rows are left untouched — never cleared to `0`/`null`/empty.

### Lockout sync failure

If the profile refresh succeeds but the lockout-encounters call fails or is unusable, the profile fields (`name`, `itemLevel`, `lastSyncedAt`) still update and the *prior* lockout rows are preserved untouched — the Character is counted in `lockoutsUnavailable`, not `failed`.

### Rate limiting

If Blizzard returns `BATTLENET_RATE_LIMITED` for any candidate, the job stops dispatching *new* refreshes for the remainder of the cycle (already-in-flight requests are left to settle) rather than retrying into the rate limit. Every candidate that hit the limit or was skipped because of it is counted in `rateLimited`, and the cycle still exits cleanly and reports its result — no retry storm, no long in-process sleep (the current Blizzard API client does not expose a trustworthy `Retry-After` contract to sleep against, so the deliberate, documented choice is to stop the cycle conservatively instead).

### Configuration failure

If Battle.net credentials are globally missing (`BATTLENET_NOT_CONFIGURED`) and there is at least one candidate, the job fails fast — before issuing any Blizzard calls — instead of reporting every candidate as an individual failure. The script exits non-zero with a clear message and never logs the credential values themselves.

### Connection sync timestamp

Successful refreshes are grouped by `BattleNetConnection`. A connection's `lastSuccessfulSyncAt` is marked **once per cycle** if at least one of its Characters refreshed successfully — never once per Character, and never at all if every Character for that connection failed.

## Relationship to manual refresh

Manual refresh (`characterBlizzardSyncService.refreshCharacter` / `refreshLinkedCharactersForRegion`) is unchanged: its 60-second `REFRESH_COOLDOWN_MS` still applies, and "Refresh All" is still available from the Web UI. The scheduled job's stale threshold is a completely separate concept — a Character manually refreshed 2 minutes ago is untouched by the manual cooldown check, but is also not yet "stale" under the (larger, default 15-minute) scheduled threshold, so the scheduled job naturally skips it too without sharing any state with the manual cooldown.

Both paths call the same reusable `refreshLinkedCharacterProfile(owner, character, connectionId, options)` function. It takes a minimal `CharacterSyncOwner = { id, name }` context rather than a full `AuthenticatedUser`, because the scheduled job has no logged-in User — it builds this context from the Character's real, persisted owner (via the eager-loaded `User` relation), never a fabricated `ADMIN` user or a bypassed ownership check.

## Activity logging

Routine scheduled sync writes **no** `ActivityEvent` rows — not one per Character, and not one per cycle. `refreshLinkedCharacterProfile` is always called with `writeActivity: false` and `updateConnectionSync: false` from the scheduled job (the connection timestamp is instead marked once per connection by the orchestration service itself, as described above). Operational results go to process/console logging (`console.info`/`console.error`), one summary line per cycle, exactly like the script's own printed summary.

## Relationship to informational raid saves

Raid lockouts are informational only, never a signup blocker (see [run-signups.md](run-signups.md)). Scheduled sync will make lockout data fresher — e.g. turning `HC 1/8` into `HC 8/8` between manual refreshes — but this can never, by itself, make a Character ineligible for a signup. `CHARACTER_ALREADY_SELECTED_OTHER_RUN` (cross-run Character reservation) is a separate, unrelated, still hard-blocking rule that this feature does not touch.

## No schema migration

No `ScheduledJob` / `CronJob` / job-lease table was added. A PostgreSQL advisory lock is sufficient for overlap protection and requires no persistent state or migration.

## Scheduling examples (documentation only — nothing here creates a scheduled task)

### Windows Task Scheduler

- **Program/script**: `cmd.exe`
- **Add arguments**: `/c npm run sync:characters`
- **Start in**: `D:\Projects\BoostingHub` (your local checkout path)
- **Trigger**: repeat every 15 minutes

### cron (generic Linux/macOS deployment)

```cron
*/15 * * * * cd /path/to/boostinghub && npm run sync:characters >> /var/log/boostinghub-sync.log 2>&1
```

Replace the path with wherever the app is deployed; nothing here should reference a specific machine's real path or credentials.
