import type { AuthenticatedUser } from "@/auth/authorization";
import type { CharacterRole, RaidDifficulty, RunStatus, SignupStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { characterRepository } from "@/repositories/character.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { getScheduleConflictsForCharacter } from "@/services/character-schedule-conflict.service";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";

export type CharacterScheduleCommitment = {
  signupId: string;
  runId: string;
  runTitle: string;
  productLabel: string;
  contentSummary: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  runStatus: RunStatus;
  signupStatus: SignupStatus;
  draftSelected: boolean;
  /** Draft roster role when draft-selected; else published role when SELECTED. */
  role: CharacterRole | null;
  scheduleConflicts: CharacterScheduleConflict[];
};

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You do not own this character.", 403);
  }
}

/**
 * Owner-facing upcoming BoostingHub Run reservations for one Character.
 * Derived only — never persists conflict rows. PENDING-only offers are excluded.
 */
export const characterScheduleCommitmentsService = {
  async listForOwner(
    user: AuthenticatedUser,
    characterId: string,
  ): Promise<CharacterScheduleCommitment[]> {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const rows = await signupRepository.listReservingCommitmentsByCharacterId(characterId);
    if (rows.length === 0) return [];

    return Promise.all(
      rows.map(async (row) => {
        const scheduleConflicts = await getScheduleConflictsForCharacter({
          targetRunId: row.run.id,
          scheduledStartAt: row.run.scheduledStartAt,
          difficulty: row.run.difficulty,
          character: {
            id: character.id,
            name: character.name,
            region: character.region,
          },
        });
        return {
          signupId: row.signupId,
          runId: row.run.id,
          runTitle: row.run.title,
          productLabel: row.run.productLabel,
          contentSummary: row.run.contentSummary,
          difficulty: row.run.difficulty,
          scheduledStartAt: row.run.scheduledStartAt,
          runStatus: row.run.status,
          signupStatus: row.status,
          draftSelected: row.draftSelected,
          role: row.selectedRole ?? row.publishedRole,
          scheduleConflicts,
        };
      }),
    );
  },
};
