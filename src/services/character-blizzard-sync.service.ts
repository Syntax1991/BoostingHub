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
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { lockoutRepository } from "@/repositories/lockout.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";

/**
 * Owns refreshing already Blizzard-linked characters: single refresh,
 * Refresh All for a region, and the current-raid lockout sync that rides
 * along with a successful profile refresh. Import/link orchestration for
 * new candidates lives in character-blizzard-import.service.ts.
 */

const REFRESH_COOLDOWN_MS = 60_000;
const REFRESH_ALL_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  const pool = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: pool }, () => runWorker()));
  return results;
}

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

    await lockoutRepository.replaceVerifiedCurrentResetLockouts(character.id, {
      raidId: derived.currentRaidId,
      resetIdentifier: derived.difficulties[0]!.resetIdentifier,
      rows: derived.difficulties.map((row) => ({
        difficulty: row.difficulty,
        bossesDefeated: row.bossesDefeated,
        isComplete: row.isComplete,
      })),
      verifiedAt: derived.verifiedAt,
    });
    return true;
  } catch (error) {
    if (isDomainError(error) && error.code === "BATTLENET_NOT_CONFIGURED") {
      throw error;
    }
    // Profile refresh may still succeed; leave prior lockout rows untouched.
    return false;
  }
}

async function refreshLinkedCharacterProfile(
  user: AuthenticatedUser,
  character: {
    id: string;
    userId: string;
    name: string;
    realm: string;
    region: "EU" | "US";
    normalizedName: string;
    normalizedRealm: string;
    wowClass: string;
    blizzardCharacterId: string | null;
    blizzardRealmId: string | null;
  },
  connectionId: string,
  options: { updateConnectionSync?: boolean; writeActivity?: boolean } = {},
): Promise<{ lockoutSynced: boolean }> {
  const updateConnectionSync = options.updateConnectionSync !== false;
  const writeActivity = options.writeActivity !== false;

  let summary;
  try {
    const realmSlug = realmSlugFromDisplayName(character.realm);
    const status = await blizzardApiClient.getCharacterProfileStatus(
      character.region,
      realmSlug,
      character.name,
    );
    if (!status.isValid) {
      throw new DomainError(
        "BLIZZARD_PROFILE_UNAVAILABLE",
        "Blizzard reports this character profile as unavailable.",
        502,
      );
    }

    summary = await blizzardApiClient.getCharacterProfileSummary(
      character.region,
      realmSlug,
      character.name,
    );
  } catch (error) {
    if (isDomainError(error)) {
      if (
        error.code === "BLIZZARD_CHARACTER_NOT_FOUND" ||
        error.code === "BLIZZARD_PROFILE_UNAVAILABLE" ||
        error.code === "BATTLENET_RATE_LIMITED" ||
        error.code === "BATTLENET_NOT_CONFIGURED"
      ) {
        throw error;
      }
      throw new DomainError(
        "BLIZZARD_SYNC_FAILED",
        "Could not refresh character from Blizzard.",
        502,
      );
    }
    throw new DomainError("BLIZZARD_SYNC_FAILED", "Could not refresh character from Blizzard.", 502);
  }

  if (summary.wowClass && summary.wowClass !== character.wowClass) {
    throw new DomainError(
      "BLIZZARD_IDENTITY_CONFLICT",
      "Blizzard class no longer matches this BoostingHub character.",
    );
  }

  if (summary.id && summary.id !== character.blizzardCharacterId) {
    throw new DomainError(
      "BLIZZARD_IDENTITY_CONFLICT",
      "Blizzard character id no longer matches the linked identity.",
    );
  }

  if (summary.realmId && summary.realmId !== character.blizzardRealmId) {
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
      userId: user.id,
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
  // still proceed, and the character's last known item level is retained
  // rather than cleared to null or a 0 sentinel.
  const syncedAt = new Date().toISOString();
  try {
    await characterRepository.applyBlizzardSync(character.id, {
      name: nextName,
      normalizedName: nextNormalizedName,
      ...(typeof summary.equippedItemLevel === "number"
        ? { itemLevel: summary.equippedItemLevel }
        : {}),
      lastSyncedAt: syncedAt,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DomainError(
        "CHARACTER_ALREADY_EXISTS",
        "Cannot rename: identity conflict after Blizzard refresh.",
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

  if (updateConnectionSync) {
    await battleNetConnectionRepository.markSuccessfulSync(connectionId, syncedAt);
  }
  if (writeActivity) {
    await activityRepository.create({
      userId: user.id,
      type: "BATTLENET_CHARACTER_REFRESHED",
      message: lockoutSynced
        ? `Refreshed ${nextName}-${character.realm} (${character.region}) from Blizzard (profile + current-raid lockouts verified).`
        : `Refreshed ${nextName}-${character.realm} (${character.region}) from Blizzard (profile only; lockouts not verified).`,
    });
  }

  return { lockoutSynced };
}

export const characterBlizzardSyncService = {
  async refreshCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertCharacterOwned(user, character);

    if (!character.blizzardCharacterId || !character.blizzardRealmId) {
      throw new DomainError(
        "BLIZZARD_CHARACTER_NOT_FOUND",
        "Character is not linked to Battle.net.",
        400,
      );
    }

    const connection = await battleNetConnectionRepository.findByUserAndRegion(
      user.id,
      character.region,
    );
    if (!connection) {
      throw new DomainError(
        "BATTLENET_NOT_CONNECTED",
        `Connect Battle.net (${character.region}) before refreshing.`,
        400,
      );
    }

    if (character.lastSyncedAt) {
      const elapsed = Date.now() - new Date(character.lastSyncedAt).getTime();
      if (elapsed < REFRESH_COOLDOWN_MS) {
        throw new DomainError(
          "BLIZZARD_REFRESH_COOLDOWN",
          "Wait at least 60 seconds between Blizzard refreshes.",
          429,
        );
      }
    }

    await refreshLinkedCharacterProfile(user, character, connection.id);

    const updated = await characterRepository.findById(character.id);
    if (!updated) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    return updated;
  },

  /**
   * Bulk-refresh active Blizzard-linked characters for one owned regional connection.
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

    const all = await characterRepository.listByUserId(user.id);
    const eligible = all.filter(
      (character) =>
        character.userId === user.id &&
        character.region === region &&
        character.isActive &&
        Boolean(character.blizzardCharacterId) &&
        Boolean(character.blizzardRealmId),
    );

    const outcome = {
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

    const results = await mapWithConcurrency(eligible, REFRESH_ALL_CONCURRENCY, async (character) => {
      if (character.lastSyncedAt) {
        const elapsed = Date.now() - new Date(character.lastSyncedAt).getTime();
        if (elapsed < REFRESH_COOLDOWN_MS) {
          return { status: "skipped" as const, lockoutSynced: false };
        }
      }

      try {
        const result = await refreshLinkedCharacterProfile(user, character, connection.id, {
          updateConnectionSync: false,
          writeActivity: false,
        });
        return { status: "refreshed" as const, lockoutSynced: result.lockoutSynced };
      } catch (error) {
        if (isDomainError(error) && error.code === "BLIZZARD_REFRESH_COOLDOWN") {
          return { status: "skipped" as const, lockoutSynced: false };
        }
        return { status: "failed" as const, lockoutSynced: false };
      }
    });

    for (const result of results) {
      if (result.status === "refreshed") {
        outcome.refreshed += 1;
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

    return outcome;
  },
};
