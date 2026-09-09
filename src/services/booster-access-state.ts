import type { BoosterAccessStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * One BoosterAccess row is reused. Rejection/revocation do not delete history.
 * Difficulty approvals never inherit: Heroic does not grant Mythic or Normal.
 */
export const BOOSTER_ACCESS_TRANSITIONS: Record<BoosterAccessStatus, readonly BoosterAccessStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["REVOKED"],
  REJECTED: ["PENDING"],
  REVOKED: ["PENDING"],
};

export function canTransitionBoosterAccess(from: BoosterAccessStatus, to: BoosterAccessStatus): boolean {
  return BOOSTER_ACCESS_TRANSITIONS[from].includes(to);
}

export function assertBoosterAccessTransition(from: BoosterAccessStatus, to: BoosterAccessStatus): void {
  if (!canTransitionBoosterAccess(from, to)) {
    throw new DomainError(
      "BOOSTER_ACCESS_INVALID_TRANSITION",
      `Booster access cannot move from ${from} to ${to}.`,
    );
  }
}

/** Owner may open a request when none exists, or after reject/revoke. */
export function canRequestFromStatus(status: BoosterAccessStatus | null): boolean {
  return status === null || status === "REJECTED" || status === "REVOKED";
}

export function isApprovedAccessStatus(status: BoosterAccessStatus): boolean {
  return status === "APPROVED";
}
