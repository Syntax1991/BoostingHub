/**
 * Derived Character schedule-integrity conflicts for a target Run start.
 * Scheduling only — never inactive, booster access, lockouts, or raid-save state.
 * Not persisted; recomputed from BoostingHub Run reservations and weekly unavailability.
 */

import { formatDateTime } from "@/lib/datetime";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import type { RaidDifficulty } from "@/models/enums";

export type RunReservationConflictInput = {
  characterId: string;
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
};

export type WeeklyUnavailableConflictInput = {
  characterId: string;
  characterName: string;
  resetIdentifier: string;
  difficulty: RaidDifficulty;
};

export type CharacterScheduleConflict =
  | {
      source: "RUN_RESERVATION";
      conflictingRunId: string;
      conflictingRunTitle: string;
      conflictingScheduledStartAt: string;
      message: string;
    }
  | {
      source: "WEEKLY_UNAVAILABLE";
      resetIdentifier: string;
      difficulty: RaidDifficulty;
      message: string;
    };

export function formatRunReservationConflictMessage(input: {
  runTitle: string;
  scheduledStartAt: string;
}): string {
  return `Another BoostingHub Run: ${input.runTitle} at ${formatDateTime(input.scheduledStartAt)}`;
}

export function formatWeeklyUnavailableConflictMessage(input: {
  characterName: string;
  resetIdentifier: string;
  difficulty: RaidDifficulty;
}): string {
  return `${input.characterName} is marked unavailable for ${DIFFICULTY_LABELS[input.difficulty]} during this reset (${input.resetIdentifier}).`;
}

function compareReservationConflicts(
  a: RunReservationConflictInput,
  b: RunReservationConflictInput,
): number {
  const startDiff = new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime();
  if (startDiff !== 0) return startDiff;
  return a.runId.localeCompare(b.runId);
}

/**
 * Builds a deterministic conflict list for one Character against a target Run start.
 * Order: WEEKLY_UNAVAILABLE first (at most one), then RUN_RESERVATION by
 * scheduledStartAt ASC, runId ASC.
 */
export function projectCharacterScheduleConflicts(input: {
  reservations: readonly RunReservationConflictInput[];
  weeklyUnavailable?: WeeklyUnavailableConflictInput | null;
}): CharacterScheduleConflict[] {
  const conflicts: CharacterScheduleConflict[] = [];
  if (input.weeklyUnavailable) {
    conflicts.push({
      source: "WEEKLY_UNAVAILABLE",
      resetIdentifier: input.weeklyUnavailable.resetIdentifier,
      difficulty: input.weeklyUnavailable.difficulty,
      message: formatWeeklyUnavailableConflictMessage(input.weeklyUnavailable),
    });
  }

  const reservations = [...input.reservations].sort(compareReservationConflicts);
  for (const row of reservations) {
    conflicts.push({
      source: "RUN_RESERVATION",
      conflictingRunId: row.runId,
      conflictingRunTitle: row.runTitle,
      conflictingScheduledStartAt: row.scheduledStartAt,
      message: formatRunReservationConflictMessage(row),
    });
  }
  return conflicts;
}

/**
 * Group raw reservation rows into a Map keyed by characterId.
 * Every Character in `characterIds` is present (empty array when no conflicts).
 */
export function projectScheduleConflictsByCharacter(input: {
  characterIds: readonly string[];
  reservations: readonly RunReservationConflictInput[];
  weeklyUnavailableByCharacterId?: ReadonlyMap<string, WeeklyUnavailableConflictInput>;
}): Map<string, CharacterScheduleConflict[]> {
  const reservationsByCharacter = new Map<string, RunReservationConflictInput[]>();
  for (const row of input.reservations) {
    const list = reservationsByCharacter.get(row.characterId) ?? [];
    list.push(row);
    reservationsByCharacter.set(row.characterId, list);
  }

  const result = new Map<string, CharacterScheduleConflict[]>();
  for (const characterId of input.characterIds) {
    result.set(
      characterId,
      projectCharacterScheduleConflicts({
        reservations: reservationsByCharacter.get(characterId) ?? [],
        weeklyUnavailable: input.weeklyUnavailableByCharacterId?.get(characterId) ?? null,
      }),
    );
  }
  return result;
}
