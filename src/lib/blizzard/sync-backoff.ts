import type { CharacterSyncErrorCode } from "@/models/enums";

/**
 * Scheduler-only failure backoff for Characters whose automatic sync keeps
 * failing. The ONE rule: the scheduler (`scheduledCharacterSyncService.runOnce`)
 * and the admin projections both call `resolveCharacterSyncRetryAt`.
 *
 * It never blocks manual actions (owner Refresh / Refresh all, admin Sync now,
 * Force refresh, Force refresh all) — those stay the escape hatch — and never
 * changes the failure itself: PROFILE_UNAVAILABLE etc. are still recorded and
 * shown. A successful sync resets syncFailureCount / lastSyncErrorCode, which
 * removes the backoff with no extra state.
 *
 * Measured from lastSyncAttemptAt (the latest attempt, manual or automatic).
 */

const HOUR_MS = 60 * 60_000;

/** Consecutive failures → minimum wait before the next automatic attempt. */
const PROGRESSIVE_TIERS: ReadonlyArray<{ minFailures: number; waitMs: number }> = [
  { minFailures: 10, waitMs: 24 * HOUR_MS },
  { minFailures: 6, waitMs: 6 * HOUR_MS },
  { minFailures: 3, waitMs: HOUR_MS },
];

type BackoffKind = "PROGRESSIVE" | "SHORT" | "NONE";

/**
 * Deliberate per-category policy:
 * - PROFILE_UNAVAILABLE / IDENTITY_CONFLICT / NAME_CONFLICT: persistent,
 *   Character-specific problems that need a human (rename, transfer, deleted
 *   character) — progressive backoff up to 24h.
 * - UPSTREAM_UNAVAILABLE / INTERNAL: usually transient or global; a single
 *   outage must not park a Character for a day — capped at 1h.
 * - RATE_LIMITED: the scheduler's whole-run 429 stop is authoritative.
 * - AUTH_OR_CONFIG: a system-wide configuration problem (the job fails fast
 *   when Battle.net is not configured), not a Character problem.
 */
export const SYNC_BACKOFF_KIND: Record<CharacterSyncErrorCode, BackoffKind> = {
  PROFILE_UNAVAILABLE: "PROGRESSIVE",
  IDENTITY_CONFLICT: "PROGRESSIVE",
  NAME_CONFLICT: "PROGRESSIVE",
  UPSTREAM_UNAVAILABLE: "SHORT",
  INTERNAL: "SHORT",
  RATE_LIMITED: "NONE",
  AUTH_OR_CONFIG: "NONE",
};

/** Minimum wait after the latest attempt; 0 = no backoff. */
export function characterSyncBackoffMs(syncFailureCount: number, lastSyncErrorCode: CharacterSyncErrorCode | null): number {
  if (!lastSyncErrorCode) return 0;
  const kind = SYNC_BACKOFF_KIND[lastSyncErrorCode];
  if (kind === "NONE") return 0;
  const tier = PROGRESSIVE_TIERS.find((entry) => syncFailureCount >= entry.minFailures);
  if (!tier) return 0;
  return kind === "SHORT" ? Math.min(tier.waitMs, HOUR_MS) : tier.waitMs;
}

/**
 * Earliest time the scheduler may attempt this Character again, or null when
 * no backoff applies (normal stale-freshness scheduling only).
 */
export function resolveCharacterSyncRetryAt(input: {
  lastSyncAttemptAt: string | null;
  syncFailureCount: number;
  lastSyncErrorCode: CharacterSyncErrorCode | null;
}): Date | null {
  const waitMs = characterSyncBackoffMs(input.syncFailureCount, input.lastSyncErrorCode);
  if (waitMs === 0 || !input.lastSyncAttemptAt) return null;
  const attemptedMs = new Date(input.lastSyncAttemptAt).getTime();
  if (!Number.isFinite(attemptedMs)) return null;
  return new Date(attemptedMs + waitMs);
}

/** True while the scheduler must NOT attempt this Character (retryAt strictly in the future). */
export function isInSchedulerBackoff(
  input: Parameters<typeof resolveCharacterSyncRetryAt>[0],
  now: Date = new Date(),
): boolean {
  const retryAt = resolveCharacterSyncRetryAt(input);
  return retryAt !== null && retryAt.getTime() > now.getTime();
}

/** Compact "18h", "2h 5m", "7m", "<1m" for the admin projections. */
export function formatRetryIn(ms: number): string {
  if (ms < 60_000) return "<1m";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
