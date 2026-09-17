import { signupRepository } from "@/repositories/signup.repository";
import { DomainError } from "@/lib/errors";
import {
  projectScheduleConflictsByCharacter,
  type CharacterScheduleConflict,
} from "@/services/character-schedule-conflict";

/**
 * Batch current schedule-integrity conflicts for Characters against one Run start.
 * One reservation repository read — never N+1 per Character.
 * Empty characterIds → empty Map.
 *
 * Manual CharacterAvailabilityBlock rows are deprecated and ignored.
 */
export async function getScheduleConflictsForCharacters(input: {
  targetRunId: string;
  scheduledStartAt: string;
  characterIds: readonly string[];
}): Promise<Map<string, CharacterScheduleConflict[]>> {
  const characterIds = [...new Set(input.characterIds.filter(Boolean))];
  if (characterIds.length === 0) {
    return new Map();
  }

  const reservations = await signupRepository.findAllReservationConflicts({
    characterIds,
    excludeRunId: input.targetRunId,
    scheduledStartAt: input.scheduledStartAt,
  });

  return projectScheduleConflictsByCharacter({
    characterIds,
    reservations,
  });
}

export async function getScheduleConflictsForCharacter(input: {
  targetRunId: string;
  scheduledStartAt: string;
  characterId: string;
}): Promise<CharacterScheduleConflict[]> {
  const byCharacter = await getScheduleConflictsForCharacters({
    targetRunId: input.targetRunId,
    scheduledStartAt: input.scheduledStartAt,
    characterIds: [input.characterId],
  });
  return byCharacter.get(input.characterId) ?? [];
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
