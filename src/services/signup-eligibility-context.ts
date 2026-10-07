import type { RaidDifficulty, WowRegion } from "@/models/enums";
import type { CharacterRunReservationConflict } from "@/models/records";
import { signupRepository } from "@/repositories/signup.repository";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";

/**
 * Attaches cross-Run reservation info to a batch of Characters in one query
 * (never N+1 per Character). BOOSTER-only concern.
 */
export async function withReservationConflicts<T extends { id: string }>(
  characters: T[],
  targetRunId: string,
  scheduledStartAt: string,
): Promise<Array<T & { reservationConflict: CharacterRunReservationConflict | null }>> {
  if (characters.length === 0) {
    return [];
  }
  const conflicts = await signupRepository.findReservationConflicts({
    characterIds: characters.map((character) => character.id),
    excludeRunId: targetRunId,
    scheduledStartAt,
  });
  const byId = new Map(
    conflicts.map((row) => [
      row.characterId,
      { runId: row.runId, runTitle: row.runTitle, scheduledStartAt: row.scheduledStartAt },
    ]),
  );
  return characters.map((character) => ({
    ...character,
    reservationConflict: byId.get(character.id) ?? null,
  }));
}

/**
 * Batch attach reservation + weekly-unavailability flags for signup/roster eligibility.
 * One reservation query + one weekly-availability query — never per Character.
 */
export async function withSignupEligibilityContext<
  T extends { id: string; name: string; region: WowRegion },
>(
  characters: T[],
  targetRunId: string,
  scheduledStartAt: string,
  difficulty: RaidDifficulty,
) {
  const [withReservations, unavailableIds] = await Promise.all([
    withReservationConflicts(characters, targetRunId, scheduledStartAt),
    characterWeeklyAvailabilityService.listUnavailableForRun(
      characters,
      scheduledStartAt,
      difficulty,
    ),
  ]);
  return withReservations.map((character) => ({
    ...character,
    weeklyUnavailable: unavailableIds.has(character.id),
  }));
}
