import type { AuthenticatedUser } from "@/auth/authorization";
import { characterRepository } from "@/repositories/character.repository";
import { signupRepository } from "@/repositories/signup.repository";
import {
  projectScheduleConflictsByCharacter,
  type CharacterScheduleConflict,
} from "@/services/character-schedule-conflict";

export type CharacterAvailabilityCheckStatus =
  | "AVAILABLE_IN_BOOSTINGHUB"
  | "COMMITTED"
  | "INACTIVE";

export type CharacterAvailabilityCheckConflict = {
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
  message: string;
};

export type CharacterAvailabilityCheckRow = {
  characterId: string;
  status: CharacterAvailabilityCheckStatus;
  conflicts: CharacterAvailabilityCheckConflict[];
};

export type CharacterAvailabilityCheckResult = {
  checkedAt: string;
  characters: CharacterAvailabilityCheckRow[];
};

function toCheckConflicts(
  conflicts: CharacterScheduleConflict[],
): CharacterAvailabilityCheckConflict[] {
  return conflicts.map((row) => ({
    runId: row.conflictingRunId,
    runTitle: row.conflictingRunTitle,
    scheduledStartAt: row.conflictingScheduledStartAt,
    message: row.message,
  }));
}

/**
 * Owner-facing Availability Check for a proposed Run start.
 * Evaluates BoostingHub Character reservations only — never personal/external calendars.
 * When Characters are already loaded: 1 batched reservation conflict read.
 */
export const characterAvailabilityCheckService = {
  async projectForCharacters(
    characters: ReadonlyArray<{ id: string; isActive: boolean }>,
    proposedStartAt: string,
  ): Promise<CharacterAvailabilityCheckResult> {
    const activeIds = characters.filter((character) => character.isActive).map((character) => character.id);

    const reservations =
      activeIds.length === 0
        ? []
        : await signupRepository.findAllReservationConflicts({
            characterIds: activeIds,
            scheduledStartAt: proposedStartAt,
          });

    const byCharacter = projectScheduleConflictsByCharacter({
      characterIds: activeIds,
      reservations,
    });

    return {
      checkedAt: proposedStartAt,
      characters: characters.map((character) => {
        if (!character.isActive) {
          return {
            characterId: character.id,
            status: "INACTIVE" as const,
            conflicts: [],
          };
        }
        const conflicts = toCheckConflicts(byCharacter.get(character.id) ?? []);
        return {
          characterId: character.id,
          status:
            conflicts.length > 0
              ? ("COMMITTED" as const)
              : ("AVAILABLE_IN_BOOSTINGHUB" as const),
          conflicts,
        };
      }),
    };
  },

  async checkOwnerCharacters(
    user: AuthenticatedUser,
    proposedStartAt: string,
  ): Promise<CharacterAvailabilityCheckResult> {
    const characters = await characterRepository.listByUserId(user.id);
    return this.projectForCharacters(characters, proposedStartAt);
  },
};
