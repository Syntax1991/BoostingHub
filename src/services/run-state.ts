import type { RunStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * Run lifecycle is independent of signup status.
 * A run can be OPEN while one signup is PENDING and another is SELECTED.
 */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["ROSTERING", "CANCELLED"],
  ROSTERING: ["PUBLISHED", "OPEN", "CANCELLED"],
  PUBLISHED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Run status cannot move from ${from} to ${to}.`,
    );
  }
}

export function isSignupWindowOpen(status: RunStatus, signupsOpen: boolean): boolean {
  return signupsOpen && (status === "OPEN" || status === "ROSTERING");
}
