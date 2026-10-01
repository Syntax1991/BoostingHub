import type { RaidDifficulty, RunStatus, SignupStatus } from "@/models/enums";

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
 *
 * Pure mapping — safe for client presentation imports.
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
