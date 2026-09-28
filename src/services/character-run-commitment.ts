import type { RaidDifficulty, RunStatus, SignupStatus, WowRegion } from "@/models/enums";
import {
  signupRepository,
  type CharacterReservationCommitmentRow,
} from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";

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
 * A commitment is relevant to the target Run only inside the same raid ID:
 * the Character's regional weekly reset containing the other Run's start
 * equals the one containing the target Run's start (lockoutService — region-
 * and DST-aware, never calendar weeks or the CURRENT/NEXT bucket).
 */
export function isSameRaidIdForCharacter(
  region: WowRegion,
  otherScheduledStartAt: string,
  targetScheduledStartAt: string,
): boolean {
  return (
    lockoutService.getResetIdentifierForRun(region, otherScheduledStartAt) ===
    lockoutService.getResetIdentifierForRun(region, targetScheduledStartAt)
  );
}

/**
 * Batched informational commitments for Roster Builder Characters: other
 * Runs in the target Run's raid ID (per Character region) where the Character
 * is reserved or committed. One repository read for all Characters. Excludes
 * the target Run. Independent of the <2h schedule conflict (the blocker),
 * which may still apply across a reset boundary.
 */
export async function getRunCommitmentsForCharacters(input: {
  characters: Array<{ id: string; region: WowRegion }>;
  excludeRunId: string;
  targetScheduledStartAt: string;
}): Promise<Map<string, CharacterRunCommitment[]>> {
  const result = new Map<string, CharacterRunCommitment[]>();
  const regionByCharacter = new Map<string, WowRegion>();
  for (const character of input.characters) {
    result.set(character.id, []);
    regionByCharacter.set(character.id, character.region);
  }
  if (input.characters.length === 0) {
    return result;
  }

  const rows = await signupRepository.listReservingCommitmentsByCharacterIds({
    characterIds: [...regionByCharacter.keys()],
    excludeRunId: input.excludeRunId,
  });

  for (const row of rows) {
    const region = regionByCharacter.get(row.characterId);
    if (!region || !isSameRaidIdForCharacter(region, row.run.scheduledStartAt, input.targetScheduledStartAt)) {
      continue;
    }
    const projected = projectCharacterRunCommitment(row);
    if (!projected) continue;
    const list = result.get(row.characterId) ?? [];
    list.push(projected);
    result.set(row.characterId, list);
  }

  return result;
}
