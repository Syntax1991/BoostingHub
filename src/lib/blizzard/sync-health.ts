import { DEFAULT_STALE_MINUTES, resolveScheduledSyncStaleMs } from "@/lib/blizzard/sync-stale";

/**
 * Authoritative Blizzard sync health for operations views (PR 2's
 * /manage/characters), kept as pure functions over persisted telemetry.
 *
 * Two separate concepts:
 * - LINKAGE: can this Character be synced at all? (not an attempt outcome)
 * - HEALTH: outcome of the real sync attempts — only meaningful when LINKED.
 * Retirement is reported separately so retired Characters render "Retired"
 * instead of raising stale/error alerts.
 */

/** Grace the ≈15-minute scheduler gets to retry before a missing/old sync counts as failing. */
export const BLIZZARD_SYNC_RETRY_GRACE_MINUTES = 30;

export type CharacterLinkageState =
  /** Blizzard ids present and the owner has a Battle.net connection for the Character's region. */
  | "LINKED"
  /** No Blizzard ids — a manual Character; never synced. */
  | "NOT_LINKED"
  /** Blizzard ids present but the owner has no connection for that region — not eligible, never synced. */
  | "NO_CONNECTION";

export type CharacterSyncHealth = "ERROR" | "NEVER_SYNCED" | "STALE" | "HEALTHY";

export function deriveCharacterLinkage(input: {
  blizzardCharacterId: string | null;
  blizzardRealmId: string | null;
  ownerHasRegionConnection: boolean;
}): CharacterLinkageState {
  if (!input.blizzardCharacterId || !input.blizzardRealmId) return "NOT_LINKED";
  return input.ownerHasRegionConnection ? "LINKED" : "NO_CONNECTION";
}

/**
 * The shared freshness primitive: a successful sync is stale once it is older
 * than the scheduler's stale threshold plus the retry grace. Also used by the
 * owner-facing deriveBlizzardSyncState, so "stale" has one definition.
 */
export function isSuccessfulSyncStale(lastSyncedAt: string, options: { now: Date; staleMinutes: number }): boolean {
  const ageMs = options.now.getTime() - new Date(lastSyncedAt).getTime();
  return ageMs > (options.staleMinutes + BLIZZARD_SYNC_RETRY_GRACE_MINUTES) * 60_000;
}

/**
 * Health of a LINKED Character. Precedence: ERROR > NEVER_SYNCED > STALE > HEALTHY.
 *
 * ERROR wins whenever the latest recorded failure is newer than the latest
 * success — e.g. success 5 minutes ago and a failure 1 minute ago is ERROR,
 * never HEALTHY. Timestamps (not the failure counter) decide, so a success
 * whose telemetry cleanup failed still reads correctly from lastSyncedAt.
 */
export function deriveCharacterSyncHealth(
  character: { lastSyncedAt: string | null; lastSyncErrorAt: string | null },
  options: { now: Date; staleMinutes: number },
): CharacterSyncHealth {
  const { lastSyncedAt, lastSyncErrorAt } = character;
  if (
    lastSyncErrorAt &&
    (!lastSyncedAt || new Date(lastSyncErrorAt).getTime() > new Date(lastSyncedAt).getTime())
  ) {
    return "ERROR";
  }
  if (!lastSyncedAt) return "NEVER_SYNCED";
  return isSuccessfulSyncStale(lastSyncedAt, options) ? "STALE" : "HEALTHY";
}

export type CharacterSyncStatus = {
  /** Retired Characters are not scheduled; views show "Retired", summaries skip them. */
  retired: boolean;
  linkage: CharacterLinkageState;
  /** Null unless LINKED. */
  health: CharacterSyncHealth | null;
};

export function deriveCharacterSyncStatus(
  character: {
    isActive: boolean;
    blizzardCharacterId: string | null;
    blizzardRealmId: string | null;
    lastSyncedAt: string | null;
    lastSyncErrorAt: string | null;
  },
  context: { ownerHasRegionConnection: boolean; now: Date; staleMinutes: number },
): CharacterSyncStatus {
  const linkage = deriveCharacterLinkage({ ...character, ownerHasRegionConnection: context.ownerHasRegionConnection });
  return {
    retired: !character.isActive,
    linkage,
    health: linkage === "LINKED" ? deriveCharacterSyncHealth(character, context) : null,
  };
}

/**
 * Stale threshold for views: BLIZZARD_SYNC_STALE_MINUTES, falling back to the
 * default when misconfigured (the scheduler itself fails loudly instead).
 */
export function resolveSyncHealthStaleMinutes(): number {
  try {
    return resolveScheduledSyncStaleMs() / 60_000;
  } catch {
    return DEFAULT_STALE_MINUTES;
  }
}
