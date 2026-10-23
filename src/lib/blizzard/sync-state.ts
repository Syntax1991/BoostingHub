import { BLIZZARD_SYNC_RETRY_GRACE_MINUTES, isSuccessfulSyncStale } from "@/lib/blizzard/sync-health";
import type { CharacterSyncErrorCode } from "@/models/enums";

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
  | { kind: "SYNCED"; lastSyncedAt: string }
  /** No sync attempt yet (or too recent to judge) — every active Character is synced, linked or not. */
  | { kind: "AWAITING_FIRST_SYNC" }
  /** Attempted but never verified, after the scheduler has had time to retry — no profile/lockout data exists. */
  | { kind: "PROFILE_UNAVAILABLE" }
  /** Previously synced; recent syncs keep failing. The last known good data is still shown. */
  | { kind: "STALE"; lastSyncedAt: string };

// The grace constant and the stale primitive live in sync-health.ts — one
// definition of "stale" for the owner page and the operations views.
export { BLIZZARD_SYNC_RETRY_GRACE_MINUTES } from "@/lib/blizzard/sync-health";

export function deriveBlizzardSyncState(
  character: {
    isActive: boolean;
    lastSyncedAt: string | null;
    lastSyncAttemptAt: string | null;
    createdAt: string | null;
  },
  options: { now: Date; staleMinutes: number },
): BlizzardSyncState {
  const nowMs = options.now.getTime();
  const graceMs = BLIZZARD_SYNC_RETRY_GRACE_MINUTES * 60_000;

  if (!character.lastSyncedAt) {
    // Inactive Characters are not scheduled, so there were no retries to fail.
    // No attempt yet (e.g. a manual Character before its first public sync) is not a failure.
    if (!character.lastSyncAttemptAt) return { kind: "AWAITING_FIRST_SYNC" };
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
  "Blizzard's profile API is not currently publishing this character's profile. Check the name and realm, log " +
  "into the character once, log out, then refresh again later.";
/** PROFILE_UNAVAILABLE can be short Blizzard propagation lag; only a repeated 404 suggests a rename / transfer. */
export const BATTLENET_REPAIR_HINT_MIN_PROFILE_FAILURES = 3;

/**
 * True when a LINKED Character's latest sync failed because Blizzard no longer
 * shows its identity under the stored name/realm (renamed, transferred or
 * re-created). Reconnecting Battle.net repairs that automatically
 * (characterBlizzardImportService.autoLinkExistingCharacters), so the owner is
 * told to reconnect — not to delete and re-import, which would drop history.
 */
export function needsBattleNetIdentityRepair(character: {
  isActive: boolean;
  blizzardCharacterId: string | null;
  lastSyncedAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncErrorCode: CharacterSyncErrorCode | null;
  syncFailureCount: number;
}): boolean {
  if (!character.isActive || !character.blizzardCharacterId || !character.lastSyncErrorAt) return false;
  const failingNow =
    !character.lastSyncedAt || new Date(character.lastSyncErrorAt).getTime() > new Date(character.lastSyncedAt).getTime();
  if (!failingNow) return false;
  if (character.lastSyncErrorCode === "IDENTITY_CONFLICT") return true;
  return (
    character.lastSyncErrorCode === "PROFILE_UNAVAILABLE" &&
    character.syncFailureCount >= BATTLENET_REPAIR_HINT_MIN_PROFILE_FAILURES
  );
}

export const BATTLENET_IDENTITY_REPAIR_TITLE = "Reconnect Battle.net to repair";
export const BATTLENET_IDENTITY_REPAIR_HINT =
  "Blizzard no longer shows this character under its stored name, realm or character ID — it was probably renamed, " +
  "transferred or re-created. Reconnect Battle.net on the Characters page: the link repairs itself and the character " +
  "keeps its signups and history. No need to delete it. If it no longer exists in-game, deactivate it instead.";

export const BLIZZARD_SYNC_STALE_HINT =
  "Recent Blizzard syncs for this character have failed. Showing the last known item level and lockouts.";
