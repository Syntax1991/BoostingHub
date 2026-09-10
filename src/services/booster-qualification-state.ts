import type { BoosterQualificationStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * One BoosterQualification row is reused per user + difficulty.
 * Re-grant from REVOKED → APPROVED. Difficulty never inherits.
 */
export const BOOSTER_QUALIFICATION_TRANSITIONS: Record<
  BoosterQualificationStatus,
  readonly BoosterQualificationStatus[]
> = {
  APPROVED: ["REVOKED"],
  REVOKED: ["APPROVED"],
};

export function canTransitionBoosterQualification(
  from: BoosterQualificationStatus,
  to: BoosterQualificationStatus,
): boolean {
  return BOOSTER_QUALIFICATION_TRANSITIONS[from].includes(to);
}

export function assertBoosterQualificationTransition(
  from: BoosterQualificationStatus,
  to: BoosterQualificationStatus,
): void {
  if (!canTransitionBoosterQualification(from, to)) {
    throw new DomainError(
      "BOOSTER_ACCESS_INVALID_TRANSITION",
      `Booster qualification cannot move from ${from} to ${to}.`,
    );
  }
}

export function isApprovedQualificationStatus(status: BoosterQualificationStatus): boolean {
  return status === "APPROVED";
}
