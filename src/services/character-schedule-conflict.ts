/**
 * Derived Character schedule-integrity conflicts for a target Run start.
 * Scheduling only — never inactive, booster access, lockouts, or raid-save state.
 * Not persisted; recomputed from reservation + CharacterAvailabilityBlock.
 */

import { compareAvailabilityBlockPrecedence, runStartFallsInAvailabilityBlock } from "@/lib/character-availability";
import { formatDateTime, formatTime } from "@/lib/datetime";

export type RunReservationConflictInput = {
  characterId: string;
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
};

export type ManualAvailabilityConflictInput = {
  id: string;
  characterId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
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
      source: "MANUAL_AVAILABILITY";
      blockId: string;
      startsAt: string;
      endsAt: string;
      reason: string | null;
      message: string;
    };

export function formatRunReservationConflictMessage(input: {
  runTitle: string;
  scheduledStartAt: string;
}): string {
  return `Another BoostingHub Run: ${input.runTitle} at ${formatDateTime(input.scheduledStartAt)}`;
}

export function formatManualAvailabilityConflictMessage(input: {
  startsAt: string;
  endsAt: string;
  reason: string | null;
}): string {
  const window = `${formatTime(input.startsAt)}–${formatTime(input.endsAt)}`;
  const base = `External availability: ${window}`;
  return input.reason ? `${base} — ${input.reason}` : base;
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
 * Order: all RUN_RESERVATION (scheduledStartAt ASC, runId ASC), then all covering
 * MANUAL_AVAILABILITY blocks (existing availability precedence).
 * Independent of input array order. Does not mutate inputs.
 */
export function projectCharacterScheduleConflicts(input: {
  runStartAt: string | Date | number;
  reservations: readonly RunReservationConflictInput[];
  availabilityBlocks: readonly ManualAvailabilityConflictInput[];
}): CharacterScheduleConflict[] {
  const reservations = [...input.reservations].sort(compareReservationConflicts);
  const reservationConflicts: CharacterScheduleConflict[] = reservations.map((row) => ({
    source: "RUN_RESERVATION",
    conflictingRunId: row.runId,
    conflictingRunTitle: row.runTitle,
    conflictingScheduledStartAt: row.scheduledStartAt,
    message: formatRunReservationConflictMessage(row),
  }));

  const covering = input.availabilityBlocks.filter((block) =>
    runStartFallsInAvailabilityBlock(input.runStartAt, block),
  );
  const orderedBlocks = [...covering].sort(compareAvailabilityBlockPrecedence);
  const availabilityConflicts: CharacterScheduleConflict[] = orderedBlocks.map((block) => ({
    source: "MANUAL_AVAILABILITY",
    blockId: block.id,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    message: formatManualAvailabilityConflictMessage(block),
  }));

  return [...reservationConflicts, ...availabilityConflicts];
}

/**
 * Group raw reservation + availability rows into a Map keyed by characterId.
 * Every Character in `characterIds` is present (empty array when no conflicts).
 */
export function projectScheduleConflictsByCharacter(input: {
  characterIds: readonly string[];
  runStartAt: string | Date | number;
  reservations: readonly RunReservationConflictInput[];
  availabilityBlocks: readonly ManualAvailabilityConflictInput[];
}): Map<string, CharacterScheduleConflict[]> {
  const reservationsByCharacter = new Map<string, RunReservationConflictInput[]>();
  for (const row of input.reservations) {
    const list = reservationsByCharacter.get(row.characterId) ?? [];
    list.push(row);
    reservationsByCharacter.set(row.characterId, list);
  }

  const blocksByCharacter = new Map<string, ManualAvailabilityConflictInput[]>();
  for (const block of input.availabilityBlocks) {
    const list = blocksByCharacter.get(block.characterId) ?? [];
    list.push(block);
    blocksByCharacter.set(block.characterId, list);
  }

  const result = new Map<string, CharacterScheduleConflict[]>();
  for (const characterId of input.characterIds) {
    result.set(
      characterId,
      projectCharacterScheduleConflicts({
        runStartAt: input.runStartAt,
        reservations: reservationsByCharacter.get(characterId) ?? [],
        availabilityBlocks: blocksByCharacter.get(characterId) ?? [],
      }),
    );
  }
  return result;
}
