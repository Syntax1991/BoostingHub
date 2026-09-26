import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import {
  isValidCharacterName,
  normalizeCharacterIdentity,
  prepareCharacterName,
} from "@/lib/character-identity";
import {
  assertCharacterOwned,
  isUniqueConstraintViolation,
  realmSlugFromDisplayName,
} from "@/lib/blizzard/character-domain";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { mapWithConcurrency } from "@/lib/concurrency";
import { withCharacterSyncLock } from "@/lib/character-sync-lock";
import { classifySyncError, logCharacterSyncFailure, type CharacterSyncTrigger } from "@/lib/blizzard/sync-error";
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { lockoutRepository } from "@/repositories/lockout.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { resolveMonotonicItemLevel, toStoredItemLevel } from "@/lib/character-item-level";
import { resolveRaiderIoItemLevelEnrichment } from "@/services/character-raider-io-ilvl";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";
import { characterBlizzardImportService } from "@/services/character-blizzard-import.service";

/**
 * Owns refreshing already Blizzard-linked characters: single refresh,
 * Refresh All for a region, and the current-raid lockout sync that rides
 * along with a successful profile refresh. Import/link orchestration for
 * new candidates lives in character-blizzard-import.service.ts. The
 * scheduled background sync (scheduled-character-sync.service.ts) reuses
 * syncLinkedCharacterProfile rather than duplicating this logic.
 *
 * After Blizzard profile apply, equipped item level may be raised from
 * Raider.IO when that source reports a higher value (soft-fail). Spec and
 * primaryRole remain BoostingHub-owned and are never overwritten here.
 *
 * Two sync modes share one pipeline (Blizzard is always read by realm + name
 * with the app's client-credentials token):
 * - VERIFIED: Blizzard ids + the owner's regional Battle.net connection
 *   (ownership proven at import/link). Ids are checked and the connection's
 *   lastSuccessfulSyncAt is marked.
 * - PUBLIC: manual Characters (no ids) or ids without an owner connection.
 *   Public profile data only — item level and raid lockouts. The class must
 *   still match; stored ids (if any) are still checked; Blizzard ids are never
 *   stamped, so a later Battle.net import can still link it to its real owner.
 */

/**
 * Manual refresh cooldown, measured from the start of the latest real attempt
 * (lastSyncAttemptAt) — successful or failed — so a failing Character cannot
 * be hammered. Scheduler freshness is separate and stays success-based.
 */
export const REFRESH_COOLDOWN_MS = 60_000;
const REFRESH_ALL_CONCURRENCY = 4;

/** Milliseconds left of the normal manual cooldown (0 = a normal refresh is allowed). */
export function manualCooldownRemainingMs(
  character: { lastSyncAttemptAt: string | null },
  now: number = Date.now(),
): number {
  if (!character.lastSyncAttemptAt) return 0;
  return Math.max(0, REFRESH_COOLDOWN_MS - (now - new Date(character.lastSyncAttemptAt).getTime()));
}

export function isInManualCooldown(character: { lastSyncAttemptAt: string | null }): boolean {
  return manualCooldownRemainingMs(character) > 0;
}

/**
 * Minimal owner context a refresh actually needs: whose identity-conflict
 * scope to check and whose name to attribute an Activity row to. Manual
 * refresh maps its AuthenticatedUser down to this; the scheduled job (which
 * has no logged-in user) builds it directly from the Character's real owner
 * — never a fabricated/admin user.
 */
export type CharacterSyncOwner = {
  id: string;
  name: string;
};

function toSyncOwner(user: AuthenticatedUser): CharacterSyncOwner {
  return { id: user.id, name: user.name };
}

/** Connection id for a VERIFIED sync; null for a PUBLIC sync (see module comment). */
export function verifiedConnectionId(
  character: { blizzardCharacterId: string | null; blizzardRealmId: string | null },
  connection: { id: string } | null | undefined,
): string | null {
  return character.blizzardCharacterId && character.blizzardRealmId && connection ? connection.id : null;
}

export type SyncableCharacter = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: "EU" | "US";
  normalizedName: string;
  normalizedRealm: string;
  wowClass: string;
  itemLevel: number | null;
  blizzardCharacterId: string | null;
  blizzardRealmId: string | null;
};

async function syncCurrentRaidLockoutsFromBlizzard(character: {
  id: string;
  name: string;
  realm: string;
  region: "EU" | "US";
}): Promise<boolean> {
  try {
    await raidRepository.ensureReferenceRaids();
    const realmSlug = realmSlugFromDisplayName(character.realm);
    const encounters = await blizzardApiClient.getCharacterRaidEncounters(
      character.region,
      realmSlug,
      character.name,
    );
    const derived = deriveCurrentResetLockouts({
      region: character.region,
      encounters,
      resetWindow: getRegionalWeeklyReset(character.region),
    });
    if (derived.status !== "derived") {
      return false;
    }

    // Sequential per-raid upserts (no transaction helper in this codebase).
    // Each call preserves other current-raid rows via getCurrentLockoutRaids().
    for (const raid of derived.raids) {
      await lockoutRepository.replaceVerifiedCurrentResetLockouts(character.id, {
        raidId: raid.raidId,
        resetIdentifier: derived.resetIdentifier,
        rows: raid.difficulties.map((row) => ({
          difficulty: row.difficulty,
          bossesDefeated: row.bossesDefeated,
          isComplete: row.isComplete,
          killedBossIds: row.bosses.filter((boss) => boss.killedThisReset).map((boss) => boss.bossId),
        })),
        verifiedAt: derived.verifiedAt,
      });
    }
    return true;
  } catch (error) {
    if (isDomainError(error) && error.code === "BATTLENET_NOT_CONFIGURED") {
      throw error;
    }
    // Profile refresh may still succeed; leave prior lockout rows untouched.
    return false;
  }
}

/** User-facing copy for a Blizzard profile that cannot be verified right now. */
export const BLIZZARD_PROFILE_UNAVAILABLE_MESSAGE =
  "Blizzard profile unavailable. The character exists in your Battle.net import, but Blizzard's profile API " +
  "is not currently publishing its profile. Log into the character once, log out, then refresh again later.";

/**
 * Blizzard status/profile could not verify this character (404, or status
 * is_valid=false). Not a deletion, not a successful zero-data sync: the
 * Character stays active, keeps its last known good data, and is retried.
 */
function profileUnavailableError(): DomainError {
  return new DomainError("BLIZZARD_PROFILE_UNAVAILABLE", BLIZZARD_PROFILE_UNAVAILABLE_MESSAGE, 404);
}

/**
 * Lower-level refresh: profile fetch/validate/apply plus current-raid lockout
 * sync. Never touches specialization/primaryRole — those are Character
 * metadata a Blizzard sync must not overwrite. Module-private: every real
 * attempt goes through syncLinkedCharacterProfile (lock + telemetry).
 */
async function refreshLinkedCharacterProfile(
  owner: CharacterSyncOwner,
  character: SyncableCharacter,
  connectionId: string | null,
  options: {
    updateConnectionSync?: boolean;
    writeActivity?: boolean;
    /** Default true for single refresh; bulk callers disable and batch afterward. */
    autoLinkWarcraftLogs?: boolean;
  } = {},
): Promise<{ lockoutSynced: boolean }> {
  const updateConnectionSync = options.updateConnectionSync !== false;
  const writeActivity = options.writeActivity !== false;
  const autoLinkWarcraftLogs = options.autoLinkWarcraftLogs !== false;

  let summary;
  const realmSlug = realmSlugFromDisplayName(character.realm);
  try {
    const status = await blizzardApiClient.getCharacterProfileStatus(
      character.region,
      realmSlug,
      character.name,
    );
    if (!status.isValid) {
      throw profileUnavailableError();
    }

    summary = await blizzardApiClient.getCharacterProfileSummary(
      character.region,
      realmSlug,
      character.name,
    );
  } catch (error) {
    if (isDomainError(error)) {
      // 404 on the status/profile endpoints means Blizzard is not publishing a
      // profile for this realm/name right now (profile propagation lag, rename,
      // transfer or deletion all look the same). Identity cannot be verified,
      // so nothing is written — not even raid lockouts from the encounters
      // endpoint, which may still answer. lastSyncedAt is left untouched so
      // the scheduler keeps retrying on its normal cadence. (Logged safely by
      // syncLinkedCharacterProfile — no character identity in logs.)
      if (error.code === "BLIZZARD_CHARACTER_NOT_FOUND") {
        throw profileUnavailableError();
      }
      if (
        error.code === "BLIZZARD_PROFILE_UNAVAILABLE" ||
        error.code === "BATTLENET_RATE_LIMITED" ||
        error.code === "BATTLENET_NOT_CONFIGURED"
      ) {
        throw error;
      }
      // Owner-facing copy stays generic; the original code is kept as cause
      // so telemetry can classify it (e.g. UPSTREAM_UNAVAILABLE vs AUTH_OR_CONFIG).
      throw new DomainError("BLIZZARD_SYNC_FAILED", "Could not refresh character from Blizzard.", 502, {
        cause: error,
      });
    }
    throw new DomainError("BLIZZARD_SYNC_FAILED", "Could not refresh character from Blizzard.", 502, {
      cause: error,
    });
  }

  if (summary.wowClass && summary.wowClass !== character.wowClass) {
    throw new DomainError(
      "BLIZZARD_IDENTITY_CONFLICT",
      "Blizzard class no longer matches this BoostingHub character.",
    );
  }

  // Stored ids are always checked; a PUBLIC sync of a manual Character has none.
  if (character.blizzardCharacterId && summary.id && summary.id !== character.blizzardCharacterId) {
    throw new DomainError(
      "BLIZZARD_IDENTITY_CONFLICT",
      "Blizzard character id no longer matches the linked identity.",
    );
  }

  if (character.blizzardRealmId && summary.realmId && summary.realmId !== character.blizzardRealmId) {
    throw new DomainError(
      "BLIZZARD_IDENTITY_CONFLICT",
      "Realm transfer detected. Automatic transfer handling is not supported.",
    );
  }

  const nextName = prepareCharacterName(summary.name || character.name);
  if (!isValidCharacterName(nextName)) {
    throw new DomainError(
      "INVALID_CHARACTER_NAME",
      "Blizzard returned a character name that BoostingHub cannot store.",
    );
  }

  const nextNormalizedName = normalizeCharacterIdentity(nextName);
  if (nextNormalizedName !== character.normalizedName) {
    const conflict = await characterRepository.findIdentityConflict({
      userId: owner.id,
      region: character.region,
      normalizedName: nextNormalizedName,
      normalizedRealm: character.normalizedRealm,
      excludeId: character.id,
    });
    if (conflict) {
      throw new DomainError(
        "CHARACTER_ALREADY_EXISTS",
        "Cannot rename: you already have another character with that name on this realm.",
      );
    }
  }

  // Missing item level does not fail the refresh: identity/name/lockout sync
  // still proceed. Observed equipped may be lower than a prior peak (e.g.
  // weapons temporarily unequipped) — never write a lower itemLevel than
  // already stored. Soft Raider.IO enrichment may raise the incoming value.
  const syncedAt = new Date().toISOString();
  const blizzardEquippedItemLevel = toStoredItemLevel(
    typeof summary.equippedItemLevel === "number" ? summary.equippedItemLevel : null,
  );
  const raiderIoItemLevel = await resolveRaiderIoItemLevelEnrichment({
    name: nextName,
    realm: character.realm,
    region: character.region,
    blizzardEquippedItemLevel,
  });
  const incomingItemLevel = raiderIoItemLevel ?? blizzardEquippedItemLevel;
  const itemLevel = resolveMonotonicItemLevel(character.itemLevel, incomingItemLevel);

  try {
    await characterRepository.applyBlizzardSync(character.id, {
      name: nextName,
      normalizedName: nextNormalizedName,
      ...(itemLevel != null ? { itemLevel } : {}),
      lastSyncedAt: syncedAt,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DomainError(
        "CHARACTER_ALREADY_EXISTS",
        "Cannot rename: identity conflict after Blizzard refresh.",
        400,
        { cause: error },
      );
    }
    throw error;
  }

  const lockoutSynced = await syncCurrentRaidLockoutsFromBlizzard({
    id: character.id,
    name: nextName,
    realm: character.realm,
    region: character.region,
  });

  if (updateConnectionSync && connectionId) {
    await battleNetConnectionRepository.markSuccessfulSync(connectionId, syncedAt);
  }
  if (writeActivity) {
    await activityRepository.create({
      userId: owner.id,
      type: "BATTLENET_CHARACTER_REFRESHED",
      message: lockoutSynced
        ? `Refreshed ${nextName}-${character.realm} (${character.region}) from Blizzard (profile + current-raid lockouts verified).`
        : `Refreshed ${nextName}-${character.realm} (${character.region}) from Blizzard (profile only; lockouts not verified).`,
    });
  }

  // Best-effort: tryAutoLinkIfMissing no-ops when an ID already exists.
  // Bulk Refresh All / scheduled sync disable this and run one bounded batch.
  if (autoLinkWarcraftLogs) {
    await characterWarcraftLogsService.tryAutoLinkIfMissing(character.id);
  }

  return { lockoutSynced };
}

export type LinkedCharacterSyncOptions = {
  updateConnectionSync?: boolean;
  writeActivity?: boolean;
  /** Default true for single refresh; bulk callers disable and batch afterward. */
  autoLinkWarcraftLogs?: boolean;
  trigger: CharacterSyncTrigger;
};

/**
 * THE entry point for a real Blizzard sync attempt of a Character (VERIFIED
 * with a connection id, PUBLIC with null) —
 * scheduled sync, owner manual refresh, owner regional Refresh All (and the
 * PR 2 admin paths). It owns concurrency and telemetry:
 *
 * 1. Per-Character advisory lock (non-blocking): if the Character is already
 *    being synced anywhere, throws CHARACTER_SYNC_IN_PROGRESS without making
 *    an attempt.
 * 2. Attempt: lastSyncAttemptAt = now (lastSyncedAt untouched).
 * 3. Success: applyBlizzardSync sets lastSyncedAt and clears the failure
 *    telemetry in the same statement.
 * 4. Failure: lastSyncErrorAt = now, lastSyncErrorCode = safe category,
 *    syncFailureCount += 1; last known good data stays; a safe structured
 *    log line (no identity) is written; the original error is rethrown.
 *    A failing telemetry write never replaces the real sync outcome.
 */
export async function syncLinkedCharacterProfile(
  owner: CharacterSyncOwner,
  character: SyncableCharacter,
  connectionId: string | null,
  options: LinkedCharacterSyncOptions,
): Promise<{ lockoutSynced: boolean }> {
  const outcome = await withCharacterSyncLock(character.id, async () => {
    await characterRepository.recordSyncAttempt(character.id, new Date().toISOString());
    try {
      return await refreshLinkedCharacterProfile(owner, character, connectionId, options);
    } catch (error) {
      const code = classifySyncError(error);
      logCharacterSyncFailure({ category: code, trigger: options.trigger, region: character.region });
      try {
        await characterRepository.recordSyncFailure(character.id, { code, failedAt: new Date().toISOString() });
      } catch {
        console.error(
          JSON.stringify({ event: "character_sync_telemetry_write_failed", trigger: options.trigger, region: character.region }),
        );
      }
      throw error;
    }
  });
  if (!outcome.acquired) {
    throw new DomainError(
      "CHARACTER_SYNC_IN_PROGRESS",
      "This character is already being refreshed. Try again in a moment.",
      409,
    );
  }
  return outcome.value;
}

export const characterBlizzardSyncService = {
  async refreshCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertCharacterOwned(user, character);
    if (!character.isActive) {
      throw new DomainError("CHARACTER_INACTIVE", "Reactivate this character before refreshing.", 400);
    }

    // Linked + connected → VERIFIED; otherwise a PUBLIC sync (no ownership proof needed).
    const connection = await battleNetConnectionRepository.findByUserAndRegion(
      user.id,
      character.region,
    );

    if (isInManualCooldown(character)) {
      throw new DomainError(
        "BLIZZARD_REFRESH_COOLDOWN",
        "Wait at least 60 seconds between Blizzard refreshes.",
        429,
      );
    }

    await syncLinkedCharacterProfile(toSyncOwner(user), character, verifiedConnectionId(character, connection), {
      trigger: "OWNER_MANUAL",
    });

    const updated = await characterRepository.findById(character.id);
    if (!updated) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    return updated;
  },

  /**
   * Bulk-refresh every active character of one connected region (linked ones
   * VERIFIED, manual ones PUBLIC).
   * Partial success is kept; cooldown skips do not fail the batch.
   */
  async refreshLinkedCharactersForRegion(user: AuthenticatedUser, regionInput: string) {
    const region = regionInput === "US" || regionInput === "EU" ? regionInput : null;
    if (!region) {
      throw new DomainError("VALIDATION_FAILED", "Region must be EU or US.");
    }

    const connection = await battleNetConnectionRepository.findByUserAndRegion(user.id, region);
    if (!connection) {
      throw new DomainError(
        "BATTLENET_NOT_CONNECTED",
        `Connect Battle.net (${region}) before refreshing.`,
        400,
      );
    }

    // First link existing manual Characters that exactly match this connection's
    // roster (no reconnect needed). Best-effort: never blocks the refresh.
    let linked = 0;
    try {
      const reconciled = await characterBlizzardImportService.reconcileBattleNetCharactersForConnection(user.id, region);
      linked = reconciled.linkedCharacterIds.length;
    } catch (error) {
      if (isDomainError(error) && error.code === "BATTLENET_NOT_CONFIGURED") throw error;
    }

    const all = await characterRepository.listByUserId(user.id);
    const eligible = all.filter(
      (character) =>
        character.userId === user.id &&
        character.region === region &&
        character.isActive,
    );

    const outcome = {
      /** Existing manual Characters newly linked by the reconciliation pass. */
      linked,
      total: eligible.length,
      refreshed: 0,
      lockoutsVerified: 0,
      lockoutsUnavailable: 0,
      skipped: 0,
      failed: 0,
    };

    if (eligible.length === 0) {
      return outcome;
    }

    const syncOwner = toSyncOwner(user);
    const refreshedCharacterIds: string[] = [];
    const results = await mapWithConcurrency(eligible, REFRESH_ALL_CONCURRENCY, async (character) => {
      if (isInManualCooldown(character)) {
        return { status: "skipped" as const, lockoutSynced: false, characterId: character.id };
      }

      try {
        const result = await syncLinkedCharacterProfile(syncOwner, character, verifiedConnectionId(character, connection), {
          updateConnectionSync: false,
          writeActivity: false,
          autoLinkWarcraftLogs: false,
          trigger: "OWNER_REGION_BULK",
        });
        return {
          status: "refreshed" as const,
          lockoutSynced: result.lockoutSynced,
          characterId: character.id,
        };
      } catch (error) {
        if (
          isDomainError(error) &&
          (error.code === "BLIZZARD_REFRESH_COOLDOWN" || error.code === "CHARACTER_SYNC_IN_PROGRESS")
        ) {
          return { status: "skipped" as const, lockoutSynced: false, characterId: character.id };
        }
        return { status: "failed" as const, lockoutSynced: false, characterId: character.id };
      }
    });

    for (const result of results) {
      if (result.status === "refreshed") {
        outcome.refreshed += 1;
        refreshedCharacterIds.push(result.characterId);
        if (result.lockoutSynced) outcome.lockoutsVerified += 1;
        else outcome.lockoutsUnavailable += 1;
      } else if (result.status === "skipped") outcome.skipped += 1;
      else outcome.failed += 1;
    }

    if (outcome.refreshed > 0) {
      await battleNetConnectionRepository.markSuccessfulSync(
        connection.id,
        new Date().toISOString(),
      );
      await activityRepository.create({
        userId: user.id,
        type: "BATTLENET_CHARACTERS_REFRESHED",
        message: `Refresh all (${region}): ${outcome.refreshed} profiles, ${outcome.lockoutsVerified} lockouts verified, ${outcome.lockoutsUnavailable} lockouts unavailable, ${outcome.skipped} skipped, ${outcome.failed} failed of ${outcome.total}.`,
      });
    }

    // Optional WCL enrichment after Blizzard outcomes + connection/activity bookkeeping.
    await characterWarcraftLogsService.tryAutoLinkManyIfMissing(refreshedCharacterIds);

    return outcome;
  },
};
