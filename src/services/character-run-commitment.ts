import type { RaidDifficulty, RunStatus, SignupStatus } from "@/models/enums";
import {
  signupRepository,
  type CharacterReservationCommitmentRow,
} from "@/repositories/signup.repository";

/**
 * Informational BoostingHub Run commitment for a Character on another Run.
 * Derived only — never persisted. Distinct from schedule conflict (blocking).
 */
export type CharacterRunCommitment = {
  runId: string;
  runTitle: string;
  productLabel: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  runStatus: RunStatus;
  state: "RESERVED" | "COMMITTED";
};

/**
 * RESERVED = draft-selected elsewhere, not yet published SELECTED.
 * COMMITTED = published SELECTED on another upcoming Run (authoritative even
 * while a replacement draft is being edited on that Run).
 */
export function deriveCharacterRunCommitmentState(
  status: SignupStatus,
  draftSelected: boolean,
): "RESERVED" | "COMMITTED" | null {
  if (status === "WITHDRAWN") return null;
  if (status === "SELECTED") return "COMMITTED";
  if (draftSelected) return "RESERVED";
  return null;
}

export function projectCharacterRunCommitment(
  row: CharacterReservationCommitmentRow,
): CharacterRunCommitment | null {
  const state = deriveCharacterRunCommitmentState(row.status, row.draftSelected);
  if (!state) return null;
  return {
    runId: row.run.id,
    runTitle: row.run.title,
    productLabel: row.run.productLabel,
    difficulty: row.run.difficulty,
    scheduledStartAt: row.run.scheduledStartAt,
    runStatus: row.run.status,
    state,
  };
}

/**
 * Batched informational commitments for Roster Builder Characters.
 * Excludes the target Run. Does not apply the 2h conflict window.
 */
export async function getRunCommitmentsForCharacters(input: {
  characterIds: string[];
  excludeRunId: string;
}): Promise<Map<string, CharacterRunCommitment[]>> {
  const result = new Map<string, CharacterRunCommitment[]>();
  for (const characterId of input.characterIds) {
    result.set(characterId, []);
  }
  if (input.characterIds.length === 0) {
    return result;
  }

  const rows = await signupRepository.listReservingCommitmentsByCharacterIds({
    characterIds: input.characterIds,
    excludeRunId: input.excludeRunId,
  });

  for (const row of rows) {
    const projected = projectCharacterRunCommitment(row);
    if (!projected) continue;
    const list = result.get(row.characterId) ?? [];
    list.push(projected);
    result.set(row.characterId, list);
  }

  return result;
}
