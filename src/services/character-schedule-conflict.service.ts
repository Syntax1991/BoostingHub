import type { RaidDifficulty, WowRegion } from "@/models/enums";
import { signupRepository } from "@/repositories/signup.repository";
import { DomainError } from "@/lib/errors";
import {
  projectScheduleConflictsByCharacter,
  type CharacterScheduleConflict,
  type WeeklyUnavailableConflictInput,
} from "@/services/character-schedule-conflict";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { lockoutService } from "@/services/lockout.service";

export type ScheduleConflictCharacterInput = {
  id: string;
  name: string;
  region: WowRegion;
};

/**
 * Batch current schedule-integrity conflicts for Characters against one Run start + difficulty.
 * One reservation read + one weekly-unavailability read — never N+1 per Character.
 * Empty characters → empty Map.
 *
 * Manual CharacterAvailabilityBlock rows are deprecated and ignored.
 */
export async function getScheduleConflictsForCharacters(input: {
  targetRunId: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  characters: readonly ScheduleConflictCharacterInput[];
}): Promise<Map<string, CharacterScheduleConflict[]>> {
  const characters = [...input.characters].filter((row) => row.id);
  const characterIds = [...new Set(characters.map((row) => row.id))];
  if (characterIds.length === 0) {
    return new Map();
  }

  const byId = new Map(characters.map((row) => [row.id, row]));
  const uniqueCharacters = characterIds.map((id) => byId.get(id)!);

  const [reservations, unavailableIds] = await Promise.all([
    signupRepository.findAllReservationConflicts({
      characterIds,
      excludeRunId: input.targetRunId,
      scheduledStartAt: input.scheduledStartAt,
    }),
    characterWeeklyAvailabilityService.listUnavailableForRun(
      uniqueCharacters,
      input.scheduledStartAt,
      input.difficulty,
    ),
  ]);

  const weeklyUnavailableByCharacterId = new Map<string, WeeklyUnavailableConflictInput>();
  for (const character of uniqueCharacters) {
    if (!unavailableIds.has(character.id)) continue;
    weeklyUnavailableByCharacterId.set(character.id, {
      characterId: character.id,
      characterName: character.name,
      resetIdentifier: lockoutService.getResetIdentifierForRun(
        character.region,
        input.scheduledStartAt,
      ),
      difficulty: input.difficulty,
    });
  }

  return projectScheduleConflictsByCharacter({
    characterIds,
    reservations,
    weeklyUnavailableByCharacterId,
  });
}

export async function getScheduleConflictsForCharacter(input: {
  targetRunId: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  character: ScheduleConflictCharacterInput;
}): Promise<CharacterScheduleConflict[]> {
  const byCharacter = await getScheduleConflictsForCharacters({
    targetRunId: input.targetRunId,
    scheduledStartAt: input.scheduledStartAt,
    difficulty: input.difficulty,
    characters: [input.character],
  });
  return byCharacter.get(input.character.id) ?? [];
}

/** Human-readable multi-line summary for DomainError messages. */
export function formatScheduleConflictMessages(
  conflicts: readonly CharacterScheduleConflict[],
): string {
  return conflicts.map((row) => row.message).join("; ");
}

/**
 * Reject NEW roster selection of a Character that currently has schedule conflicts.
 * Does not remove existing selection — callers decide when to invoke.
 */
export function assertCharacterSelectableForSchedule(
  characterLabel: string,
  conflicts: readonly CharacterScheduleConflict[],
): void {
  if (conflicts.length === 0) return;
  throw new DomainError(
    "CHARACTER_SCHEDULE_CONFLICT",
    `${characterLabel} has a schedule conflict and cannot be newly selected. ${formatScheduleConflictMessages(conflicts)}`,
  );
}

type ConflictedCharacter = {
  characterId: string;
  characterLabel: string;
  conflicts: CharacterScheduleConflict[];
};

/**
 * Reject roster publish when any selected Booster currently has schedule conflicts.
 * Names are sorted lexicographically so the message is independent of selection order.
 */
export function assertRosterPublishableForSchedule(conflicted: readonly ConflictedCharacter[]): void {
  if (conflicted.length === 0) return;
  const ordered = [...conflicted].sort((a, b) =>
    a.characterLabel.localeCompare(b.characterLabel) || a.characterId.localeCompare(b.characterId),
  );
  const detail = ordered
    .map((row) => `${row.characterLabel}: ${formatScheduleConflictMessages(row.conflicts)}`)
    .join(" | ");
  throw new DomainError(
    "ROSTER_HAS_SCHEDULE_CONFLICTS",
    `Roster has schedule conflicts and cannot be published. ${detail}`,
  );
}

export type { CharacterScheduleConflict };
