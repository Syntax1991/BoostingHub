import type { AuthenticatedUser } from "@/auth/authorization";
import type { RaidDifficulty, WowRegion } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { normalizeUnavailableDifficulties } from "@/lib/weekly-availability-display";
import { characterRepository } from "@/repositories/character.repository";
import { characterWeeklyAvailabilityRepository } from "@/repositories/character-weekly-availability.repository";
import { lockoutService } from "@/services/lockout.service";

export type WeeklyAvailabilityStatus = "AVAILABLE" | "UNAVAILABLE";

export type CharacterWeeklyAvailabilityProjection = {
  characterId: string;
  status: WeeklyAvailabilityStatus;
  /** Sorted NORMAL → HEROIC → MYTHIC. Empty when Available. */
  unavailableDifficulties: RaidDifficulty[];
  resetIdentifier: string;
  region: WowRegion;
  /** Compact current-reset window for UI (Europe/Berlin dates). */
  resetWindowLabel: string;
};

function resetWindowLabel(region: WowRegion, reset = getRegionalWeeklyReset(region)): string {
  return `${region} · ${formatDate(reset.start)} → ${formatDate(reset.end)}`;
}

function resetKey(characterId: string, resetIdentifier: string): string {
  return `${characterId}:${resetIdentifier}`;
}

function projectFromDifficulties(input: {
  characterId: string;
  region: WowRegion;
  resetIdentifier: string;
  resetWindowLabel: string;
  unavailableDifficulties: readonly RaidDifficulty[];
}): CharacterWeeklyAvailabilityProjection {
  const unavailableDifficulties = normalizeUnavailableDifficulties(input.unavailableDifficulties);
  return {
    characterId: input.characterId,
    status: unavailableDifficulties.length > 0 ? "UNAVAILABLE" : "AVAILABLE",
    unavailableDifficulties,
    resetIdentifier: input.resetIdentifier,
    region: input.region,
    resetWindowLabel: input.resetWindowLabel,
  };
}

/**
 * Owner-controlled weekly Character availability for a regional WoW reset.
 * Presence of CharacterWeeklyUnavailability for a difficulty = Unavailable for
 * that difficulty. Absence = Available (default). Independent of BoostingHub
 * Run reservations and lockouts.
 */
export const characterWeeklyAvailabilityService = {
  /**
   * Batch current-reset projection for owned Characters already loaded.
   * 1 repository read for all Characters (grouped by regional reset keys).
   */
  async projectCurrentForCharacters(
    characters: ReadonlyArray<{ id: string; region: WowRegion }>,
  ): Promise<Map<string, CharacterWeeklyAvailabilityProjection>> {
    const keys = characters.map((character) => {
      const reset = getRegionalWeeklyReset(character.region);
      return {
        characterId: character.id,
        region: character.region,
        resetIdentifier: reset.resetIdentifier,
        reset,
      };
    });

    const byKey = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys(
      keys.map((row) => ({
        characterId: row.characterId,
        resetIdentifier: row.resetIdentifier,
      })),
    );

    const result = new Map<string, CharacterWeeklyAvailabilityProjection>();
    for (const row of keys) {
      result.set(
        row.characterId,
        projectFromDifficulties({
          characterId: row.characterId,
          region: row.region,
          resetIdentifier: row.resetIdentifier,
          resetWindowLabel: resetWindowLabel(row.region, row.reset),
          unavailableDifficulties: byKey.get(resetKey(row.characterId, row.resetIdentifier)) ?? [],
        }),
      );
    }
    return result;
  },

  async getCurrentForOwner(
    user: AuthenticatedUser,
    characterId: string,
  ): Promise<CharacterWeeklyAvailabilityProjection> {
    const character = await characterRepository.findOwnedById(user.id, characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.");
    }
    const map = await this.projectCurrentForCharacters([character]);
    const projected = map.get(character.id);
    if (!projected) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    return projected;
  },

  /**
   * Set Available / Unavailable difficulties for the Character's CURRENT regional reset.
   * Does not accept a client-supplied resetIdentifier. Empty difficulties when
   * available=false is rejected. Available clears every difficulty row for the reset.
   */
  async setCurrentResetAvailability(
    user: AuthenticatedUser,
    input: {
      characterId: string;
      available: boolean;
      unavailableDifficulties?: readonly RaidDifficulty[];
    },
  ): Promise<CharacterWeeklyAvailabilityProjection> {
    const character = await characterRepository.findOwnedById(user.id, input.characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.");
    }

    const reset = getRegionalWeeklyReset(character.region);
    let unavailableDifficulties: RaidDifficulty[] = [];

    if (input.available) {
      await characterWeeklyAvailabilityRepository.clearUnavailable(
        character.id,
        reset.resetIdentifier,
      );
    } else {
      unavailableDifficulties = normalizeUnavailableDifficulties(
        input.unavailableDifficulties ?? [],
      );
      if (unavailableDifficulties.length === 0) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Select at least one difficulty when marking a Character unavailable.",
        );
      }
      await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
        character.id,
        reset.resetIdentifier,
        unavailableDifficulties,
      );
    }

    return projectFromDifficulties({
      characterId: character.id,
      region: character.region,
      resetIdentifier: reset.resetIdentifier,
      resetWindowLabel: resetWindowLabel(character.region, reset),
      unavailableDifficulties,
    });
  },

  /**
   * Batch: Characters unavailable for the regional reset containing
   * `scheduledStartAt` at the given Run difficulty.
   */
  async listUnavailableForRun(
    characters: ReadonlyArray<{ id: string; region: WowRegion }>,
    scheduledStartAt: string,
    difficulty: RaidDifficulty,
  ): Promise<Set<string>> {
    if (characters.length === 0) return new Set();
    const keys = characters.map((character) => ({
      characterId: character.id,
      resetIdentifier: lockoutService.getResetIdentifierForRun(
        character.region,
        scheduledStartAt,
      ),
    }));
    const byKey = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys(
      keys,
    );
    const characterIds = new Set<string>();
    for (const key of keys) {
      const difficulties = byKey.get(resetKey(key.characterId, key.resetIdentifier)) ?? [];
      if (difficulties.includes(difficulty)) {
        characterIds.add(key.characterId);
      }
    }
    return characterIds;
  },

  isUnavailableForResetDifficulty(
    unavailableByKey: Map<string, RaidDifficulty[]>,
    characterId: string,
    resetIdentifier: string,
    difficulty: RaidDifficulty,
  ): boolean {
    return (unavailableByKey.get(resetKey(characterId, resetIdentifier)) ?? []).includes(
      difficulty,
    );
  },
};
