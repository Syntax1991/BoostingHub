import { DomainError, isDomainError } from "@/lib/errors";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import { mapWithConcurrency } from "@/lib/concurrency";
import { characterRepository } from "@/repositories/character.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { refreshLinkedCharacterProfile } from "@/services/character-blizzard-sync.service";
import type { ScheduledCharacterSyncCandidate } from "@/models/records";

/**
 * Orchestrates the one-shot scheduled Blizzard character sync job. The app
 * never owns the ~15-minute cadence — an external scheduler (cron, Windows
 * Task Scheduler, ...) invokes `npm run sync:characters` on that cadence,
 * and each invocation calls runOnce() exactly once and exits. See
 * docs/features/scheduled-character-sync.md.
 */

const DEFAULT_STALE_MINUTES = 15;
const SCHEDULED_SYNC_CONCURRENCY = 4;

/**
 * Advisory lock namespace: a stable, documented (classId, objectId) pair
 * reserved for this job. Only this job ever acquires (837462, 1) — pick a
 * different objectId for any future scheduled job sharing the namespace, so
 * unrelated jobs never contend on the same key by accident.
 */
export const SCHEDULED_CHARACTER_SYNC_LOCK_KEY = { classId: 837462, objectId: 1 } as const;

export type ScheduledCharacterSyncResult = {
  status: "COMPLETED" | "SKIPPED_ALREADY_RUNNING";
  totalCandidates: number;
  refreshed: number;
  lockoutsVerified: number;
  lockoutsUnavailable: number;
  failed: number;
  rateLimited: number;
  connectionsUpdated: number;
  durationMs: number;
};

function emptyResult(status: ScheduledCharacterSyncResult["status"], durationMs: number): ScheduledCharacterSyncResult {
  return {
    status,
    totalCandidates: 0,
    refreshed: 0,
    lockoutsVerified: 0,
    lockoutsUnavailable: 0,
    failed: 0,
    rateLimited: 0,
    connectionsUpdated: 0,
    durationMs,
  };
}

/**
 * Resolves the stale threshold from BLIZZARD_SYNC_STALE_MINUTES. Missing env
 * deliberately falls back to the documented default (15). A *present but
 * invalid* value (non-numeric, zero, negative, or fractional) fails loudly
 * instead of silently coercing to a default or permitting a 0-minute
 * busy-loop threshold — a misconfigured production env should be visible,
 * not quietly hammer Blizzard every cycle.
 */
export function resolveScheduledSyncStaleMs(): number {
  const raw = process.env.BLIZZARD_SYNC_STALE_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_STALE_MINUTES * 60_000;
  }

  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(
      `BLIZZARD_SYNC_STALE_MINUTES must be a positive integer (got "${raw}"). ` +
        "Unset it to use the default of 15 minutes.",
    );
  }

  return minutes * 60_000;
}

type CandidateOutcome =
  | { status: "refreshed"; lockoutSynced: boolean }
  | { status: "failed" }
  | { status: "rate_limited" };

/**
 * Refreshes one candidate, respecting a shared "stop dispatching" flag so
 * that once Blizzard starts rate-limiting, remaining pool workers stop
 * issuing new requests for the rest of this cycle instead of retrying into
 * the rate limit. Already-in-flight requests are left to settle naturally.
 */
async function refreshCandidate(
  candidate: ScheduledCharacterSyncCandidate,
  rateLimitedRef: { current: boolean },
): Promise<CandidateOutcome> {
  if (rateLimitedRef.current) {
    return { status: "rate_limited" };
  }

  try {
    const result = await refreshLinkedCharacterProfile(
      candidate.owner,
      candidate.character,
      candidate.connection.id,
      { updateConnectionSync: false, writeActivity: false },
    );
    return { status: "refreshed", lockoutSynced: result.lockoutSynced };
  } catch (error) {
    if (isDomainError(error) && error.code === "BATTLENET_RATE_LIMITED") {
      rateLimitedRef.current = true;
      return { status: "rate_limited" };
    }
    // Profile unavailable, identity conflict, realm transfer, transient
    // Blizzard error, etc. — one broken Character must not fail the job;
    // refreshLinkedCharacterProfile already guarantees it left the
    // Character's existing itemLevel/lockouts untouched on failure.
    return { status: "failed" };
  }
}

export type ScheduledCharacterSyncDryRunResult = {
  status: "COMPLETED" | "SKIPPED_ALREADY_RUNNING";
  totalCandidates: number;
  distinctUsers: number;
  distinctConnections: number;
  byRegion: Record<string, number>;
};

export const scheduledCharacterSyncService = {
  /**
   * Read-only candidate audit: acquires the same job lock (so it never runs
   * concurrently with a real cycle) and reports candidate counts, but makes
   * no Blizzard calls and no DB mutations. Intended for a cautious pre-check
   * before the first real `npm run sync:characters` against real data.
   */
  async dryRun(): Promise<ScheduledCharacterSyncDryRunResult> {
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    if (!handle) {
      return { status: "SKIPPED_ALREADY_RUNNING", totalCandidates: 0, distinctUsers: 0, distinctConnections: 0, byRegion: {} };
    }

    try {
      const staleMs = resolveScheduledSyncStaleMs();
      const staleBefore = new Date(Date.now() - staleMs).toISOString();
      const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });

      const byRegion: Record<string, number> = {};
      for (const candidate of candidates) {
        byRegion[candidate.character.region] = (byRegion[candidate.character.region] ?? 0) + 1;
      }

      return {
        status: "COMPLETED",
        totalCandidates: candidates.length,
        distinctUsers: new Set(candidates.map((candidate) => candidate.owner.id)).size,
        distinctConnections: new Set(candidates.map((candidate) => candidate.connection.id)).size,
        byRegion,
      };
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },

  /**
   * Runs exactly one sync cycle: acquire the job lock, load global stale
   * candidates, refresh them at a global concurrency of
   * SCHEDULED_SYNC_CONCURRENCY, mark each BattleNetConnection that had at
   * least one successful refresh, release the lock, and return a structured
   * result. Never schedules itself again — the caller (scripts/
   * sync-blizzard-characters.ts) is invoked once per external tick.
   */
  async runOnce(): Promise<ScheduledCharacterSyncResult> {
    const start = Date.now();
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    if (!handle) {
      return emptyResult("SKIPPED_ALREADY_RUNNING", Date.now() - start);
    }

    try {
      const staleMs = resolveScheduledSyncStaleMs();
      const staleBefore = new Date(Date.now() - staleMs).toISOString();
      const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });

      if (candidates.length === 0) {
        return { ...emptyResult("COMPLETED", Date.now() - start), totalCandidates: 0 };
      }

      // A configuration problem (missing Blizzard credentials) is an
      // operational failure of the whole job, not 30 individual Character
      // failures — fail fast, before issuing any Blizzard calls.
      if (!isBlizzardConfigured()) {
        throw new DomainError(
          "BATTLENET_NOT_CONFIGURED",
          "Battle.net integration is not configured; scheduled character sync cannot run.",
          503,
        );
      }

      const rateLimitedRef = { current: false };
      const outcomes = await mapWithConcurrency(
        candidates,
        SCHEDULED_SYNC_CONCURRENCY,
        (candidate) => refreshCandidate(candidate, rateLimitedRef),
      );

      const refreshedConnectionIds = new Set<string>();
      let refreshed = 0;
      let lockoutsVerified = 0;
      let lockoutsUnavailable = 0;
      let failed = 0;
      let rateLimited = 0;

      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === "refreshed") {
          refreshed += 1;
          if (outcome.lockoutSynced) lockoutsVerified += 1;
          else lockoutsUnavailable += 1;
          refreshedConnectionIds.add(candidates[index]!.connection.id);
        } else if (outcome.status === "rate_limited") {
          rateLimited += 1;
        } else {
          failed += 1;
        }
      }

      const syncedAt = new Date().toISOString();
      for (const connectionId of refreshedConnectionIds) {
        await battleNetConnectionRepository.markSuccessfulSync(connectionId, syncedAt);
      }

      const durationMs = Date.now() - start;
      console.info(
        `[scheduled-character-sync] candidates=${candidates.length} refreshed=${refreshed} ` +
          `lockoutsVerified=${lockoutsVerified} lockoutsUnavailable=${lockoutsUnavailable} ` +
          `failed=${failed} rateLimited=${rateLimited} connectionsUpdated=${refreshedConnectionIds.size} ` +
          `durationMs=${durationMs}`,
      );

      return {
        status: "COMPLETED",
        totalCandidates: candidates.length,
        refreshed,
        lockoutsVerified,
        lockoutsUnavailable,
        failed,
        rateLimited,
        connectionsUpdated: refreshedConnectionIds.size,
        durationMs,
      };
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};
