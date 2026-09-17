import type { AuthenticatedUser } from "@/auth/authorization";
import type { WowRegion } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { characterRepository } from "@/repositories/character.repository";
import { characterWeeklyAvailabilityRepository } from "@/repositories/character-weekly-availability.repository";
import { lockoutService } from "@/services/lockout.service";

export type WeeklyAvailabilityStatus = "AVAILABLE" | "UNAVAILABLE";

export type CharacterWeeklyAvailabilityProjection = {
  characterId: string;
  status: WeeklyAvailabilityStatus;
  resetIdentifier: string;
  region: WowRegion;
  /** Compact current-reset window for UI (Europe/Berlin dates). */
  resetWindowLabel: string;
};

function resetWindowLabel(region: WowRegion, reset = getRegionalWeeklyReset(region)): string {
  return `${region} · ${formatDate(reset.start)} → ${formatDate(reset.end)}`;
}

function unavailableKey(characterId: string, resetIdentifier: string): string {
  return `${characterId}:${resetIdentifier}`;
}

/**
 * Owner-controlled weekly Character availability for a regional WoW reset.
 * Presence of CharacterWeeklyUnavailability = Unavailable; absence = Available.
 * Independent of BoostingHub Run reservations and lockouts.
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

    const unavailable = await characterWeeklyAvailabilityRepository.listUnavailableKeys(
      keys.map((row) => ({
        characterId: row.characterId,
        resetIdentifier: row.resetIdentifier,
      })),
    );

    const result = new Map<string, CharacterWeeklyAvailabilityProjection>();
    for (const row of keys) {
      result.set(row.characterId, {
        characterId: row.characterId,
        status: unavailable.has(unavailableKey(row.characterId, row.resetIdentifier))
          ? "UNAVAILABLE"
          : "AVAILABLE",
        resetIdentifier: row.resetIdentifier,
        region: row.region,
        resetWindowLabel: resetWindowLabel(row.region, row.reset),
      });
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
   * Set Available / Unavailable for the Character's CURRENT regional reset only.
   * Does not accept a client-supplied resetIdentifier.
   */
  async setCurrentResetAvailability(
    user: AuthenticatedUser,
    input: { characterId: string; available: boolean },
  ): Promise<CharacterWeeklyAvailabilityProjection> {
    const character = await characterRepository.findOwnedById(user.id, input.characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.");
    }

    const reset = getRegionalWeeklyReset(character.region);
    if (input.available) {
      await characterWeeklyAvailabilityRepository.clearUnavailable(
        character.id,
        reset.resetIdentifier,
      );
    } else {
      await characterWeeklyAvailabilityRepository.setUnavailable(
        character.id,
        reset.resetIdentifier,
      );
    }

    return {
      characterId: character.id,
      status: input.available ? "AVAILABLE" : "UNAVAILABLE",
      resetIdentifier: reset.resetIdentifier,
      region: character.region,
      resetWindowLabel: resetWindowLabel(character.region, reset),
    };
  },

  /**
   * Batch: which Characters are Unavailable for the regional reset containing
   * `scheduledStartAt` (per Character region). Used by schedule conflict projection.
   */
  async listUnavailableForRunStart(
    characters: ReadonlyArray<{ id: string; region: WowRegion }>,
    scheduledStartAt: string,
  ): Promise<Set<string>> {
    if (characters.length === 0) return new Set();
    const keys = characters.map((character) => ({
      characterId: character.id,
      resetIdentifier: lockoutService.getResetIdentifierForRun(
        character.region,
        scheduledStartAt,
      ),
    }));
    const unavailable = await characterWeeklyAvailabilityRepository.listUnavailableKeys(keys);
    const characterIds = new Set<string>();
    for (const key of keys) {
      if (unavailable.has(unavailableKey(key.characterId, key.resetIdentifier))) {
        characterIds.add(key.characterId);
      }
    }
    return characterIds;
  },

  isUnavailableForReset(
    unavailableKeys: Set<string>,
    characterId: string,
    resetIdentifier: string,
  ): boolean {
    return unavailableKeys.has(unavailableKey(characterId, resetIdentifier));
  },
};
