import { BLIZZARD_SYNC_RETRY_GRACE_MINUTES, isSuccessfulSyncStale } from "@/lib/blizzard/sync-health";

/**
 * User-facing Blizzard sync state for a Character, derived from what is
 * already persisted (no sync-status column):
 *
 * - `lastSyncedAt` only advances on a verified profile sync. A failed sync —
 *   including a Blizzard status/profile 404 — never touches it, so the
 *   scheduler keeps retrying the Character on its normal cadence.
 * - The scheduler retries a Character whenever `lastSyncedAt` is null or older
 *   than the stale window. A linked Character that stays unsynced past one
 *   retry grace period therefore has recent failed attempts, typically
 *   "Blizzard profile unavailable".
 */
export type BlizzardSyncState =
  | { kind: "NOT_LINKED" }
  | { kind: "SYNCED"; lastSyncedAt: string }
  /** Linked recently; the first verified sync has not had a chance to run yet. */
  | { kind: "AWAITING_FIRST_SYNC" }
  /** Linked but never verified, after the scheduler has had time to retry — no profile/lockout data exists. */
  | { kind: "PROFILE_UNAVAILABLE" }
  /** Previously synced; recent syncs keep failing. The last known good data is still shown. */
  | { kind: "STALE"; lastSyncedAt: string };

// The grace constant and the stale primitive live in sync-health.ts — one
// definition of "stale" for the owner page and the operations views.
export { BLIZZARD_SYNC_RETRY_GRACE_MINUTES } from "@/lib/blizzard/sync-health";

export function deriveBlizzardSyncState(
  character: { blizzardLinked: boolean; isActive: boolean; lastSyncedAt: string | null; createdAt: string | null },
  options: { now: Date; staleMinutes: number },
): BlizzardSyncState {
  if (!character.blizzardLinked) return { kind: "NOT_LINKED" };
  const nowMs = options.now.getTime();
  const graceMs = BLIZZARD_SYNC_RETRY_GRACE_MINUTES * 60_000;

  if (!character.lastSyncedAt) {
    // Inactive Characters are not scheduled, so there were no retries to fail.
    const createdMs = character.createdAt ? new Date(character.createdAt).getTime() : nowMs;
    return character.isActive && nowMs - createdMs > graceMs
      ? { kind: "PROFILE_UNAVAILABLE" }
      : { kind: "AWAITING_FIRST_SYNC" };
  }

  if (character.isActive && isSuccessfulSyncStale(character.lastSyncedAt, options)) {
    return { kind: "STALE", lastSyncedAt: character.lastSyncedAt };
  }
  return { kind: "SYNCED", lastSyncedAt: character.lastSyncedAt };
}

export const BLIZZARD_PROFILE_UNAVAILABLE_TITLE = "Blizzard profile unavailable";
export const BLIZZARD_PROFILE_UNAVAILABLE_HINT =
  "The character exists in your Battle.net import, but Blizzard's profile API is not currently publishing its " +
  "profile. Log into the character once, log out, then refresh again later.";
export const BLIZZARD_SYNC_STALE_HINT =
  "Recent Blizzard syncs for this character have failed. Showing the last known item level and lockouts.";
