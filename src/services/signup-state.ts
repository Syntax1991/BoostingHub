import type { RunStatus, SignupStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * Signup lifecycle is independent of run lifecycle.
 * Withdrawing a signup does not cancel the run.
 */
export const SIGNUP_TRANSITIONS: Record<SignupStatus, readonly SignupStatus[]> = {
  PENDING: ["SELECTED", "NOT_SELECTED", "WITHDRAWN"],
  SELECTED: ["NOT_SELECTED", "WITHDRAWN"],
  NOT_SELECTED: ["SELECTED", "WITHDRAWN"],
  WITHDRAWN: [],
};

/** Once a roster is published, SELECTED players cannot self-withdraw. */
const ROSTER_LOCKED_RUN_STATUSES: readonly RunStatus[] = ["PUBLISHED", "IN_PROGRESS", "COMPLETED"];

export function canTransitionSignup(from: SignupStatus, to: SignupStatus): boolean {
  return SIGNUP_TRANSITIONS[from].includes(to);
}

export function assertSignupTransition(from: SignupStatus, to: SignupStatus): void {
  if (!canTransitionSignup(from, to)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Signup status cannot move from ${from} to ${to}.`,
    );
  }
}

/**
 * Self-withdrawal is a player action, not a raid-lead override.
 * SELECTED + published-or-later is locked so a published roster stays stable.
 */
export function canSelfWithdrawSignup(signupStatus: SignupStatus, runStatus: RunStatus): boolean {
  if (signupStatus === "WITHDRAWN" || signupStatus === "NOT_SELECTED") {
    return false;
  }
  if (runStatus === "COMPLETED" || runStatus === "CANCELLED") {
    return false;
  }
  if (signupStatus === "SELECTED" && ROSTER_LOCKED_RUN_STATUSES.includes(runStatus)) {
    return false;
  }
  return signupStatus === "PENDING" || signupStatus === "SELECTED";
}

/** Withdrawn rows stay persisted; they do not block a later revive of the same combination. */
export function isBlockingDuplicate(status: SignupStatus): boolean {
  return status !== "WITHDRAWN";
}
