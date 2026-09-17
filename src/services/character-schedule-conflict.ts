/**
 * Derived Character schedule-integrity conflicts for a target Run start.
 * Scheduling only — never inactive, booster access, lockouts, or raid-save state.
 * Not persisted; recomputed from BoostingHub Run reservations only.
 */

import { formatDateTime } from "@/lib/datetime";

export type RunReservationConflictInput = {
  characterId: string;
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
};

export type CharacterScheduleConflict = {
  source: "RUN_RESERVATION";
  conflictingRunId: string;
  conflictingRunTitle: string;
  conflictingScheduledStartAt: string;
  message: string;
};

export function formatRunReservationConflictMessage(input: {
  runTitle: string;
  scheduledStartAt: string;
}): string {
  return `Another BoostingHub Run: ${input.runTitle} at ${formatDateTime(input.scheduledStartAt)}`;
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
 * Order: RUN_RESERVATION by scheduledStartAt ASC, runId ASC.
 * Independent of input array order. Does not mutate inputs.
 */
export function projectCharacterScheduleConflicts(input: {
  reservations: readonly RunReservationConflictInput[];
}): CharacterScheduleConflict[] {
  const reservations = [...input.reservations].sort(compareReservationConflicts);
  return reservations.map((row) => ({
    source: "RUN_RESERVATION" as const,
    conflictingRunId: row.runId,
    conflictingRunTitle: row.runTitle,
    conflictingScheduledStartAt: row.scheduledStartAt,
    message: formatRunReservationConflictMessage(row),
  }));
}

/**
 * Group raw reservation rows into a Map keyed by characterId.
 * Every Character in `characterIds` is present (empty array when no conflicts).
 */
export function projectScheduleConflictsByCharacter(input: {
  characterIds: readonly string[];
  reservations: readonly RunReservationConflictInput[];
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
      }),
    );
  }
  return result;
}
