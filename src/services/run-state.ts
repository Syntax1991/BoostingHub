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

export const RUN_COMPOSITION_MIN = 0;
export const RUN_COMPOSITION_MAX = 40;
export const RUN_TITLE_MAX = 80;
export const RUN_NOTES_MAX = 500;
export const ATTENDANCE_NOTE_MAX = 200;
/** New runs may be a few minutes in the past to avoid brittle clock races. */
export const RUN_SCHEDULE_PAST_GRACE_MS = 5 * 60_000;

const PLANNING_EDITABLE_STATUSES: readonly RunStatus[] = ["DRAFT", "OPEN", "ROSTERING"];
const IDENTITY_EDITABLE_STATUSES: readonly RunStatus[] = ["DRAFT", "OPEN"];
const SIGNUP_WINDOW_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING"];
const CANCELLABLE_STATUSES: readonly RunStatus[] = ["DRAFT", "OPEN", "ROSTERING", "PUBLISHED"];
const RAID_LEAD_REASSIGNABLE_STATUSES: readonly RunStatus[] = ["DRAFT", "OPEN", "ROSTERING"];

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

export type RunLifecycleCapabilities = {
  canEdit: boolean;
  canEditIdentity: boolean;
  canEditPlanning: boolean;
  canReassignRaidLead: boolean;
  canOpen: boolean;
  canCloseSignups: boolean;
  canReopenSignups: boolean;
  canCancel: boolean;
  canStart: boolean;
  canManageAttendance: boolean;
  canComplete: boolean;
};

export function emptyRunCapabilities(): RunLifecycleCapabilities {
  return {
    canEdit: false,
    canEditIdentity: false,
    canEditPlanning: false,
    canReassignRaidLead: false,
    canOpen: false,
    canCloseSignups: false,
    canReopenSignups: false,
    canCancel: false,
    canStart: false,
    canManageAttendance: false,
    canComplete: false,
  };
}

export function canEditPlanningFields(status: RunStatus): boolean {
  return PLANNING_EDITABLE_STATUSES.includes(status);
}

export function canEditIdentityFields(status: RunStatus, hasSignupHistory: boolean): boolean {
  return IDENTITY_EDITABLE_STATUSES.includes(status) && !hasSignupHistory;
}

export function canReassignRaidLead(status: RunStatus, actorIsAdmin: boolean): boolean {
  return actorIsAdmin && RAID_LEAD_REASSIGNABLE_STATUSES.includes(status);
}

export function canOpenRun(status: RunStatus): boolean {
  return status === "DRAFT";
}

export function canToggleSignupWindow(status: RunStatus): boolean {
  return SIGNUP_WINDOW_STATUSES.includes(status);
}

export function canCancelRun(status: RunStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

export function canStartRun(status: RunStatus): boolean {
  return status === "PUBLISHED";
}

export function canManageAttendance(status: RunStatus): boolean {
  return status === "IN_PROGRESS";
}

export function canCompleteRun(status: RunStatus): boolean {
  return status === "IN_PROGRESS";
}

/**
 * Authoritative editability and lifecycle actions for an already-authorized manager.
 * Views must render these flags, not recompute them from RunStatus.
 */
export function getRunLifecycleCapabilities(input: {
  status: RunStatus;
  signupsOpen: boolean;
  hasSignupHistory: boolean;
  actorIsAdmin: boolean;
}): RunLifecycleCapabilities {
  const identity = canEditIdentityFields(input.status, input.hasSignupHistory);
  const planning = canEditPlanningFields(input.status);
  const reassign = canReassignRaidLead(input.status, input.actorIsAdmin);
  const windowToggle = canToggleSignupWindow(input.status);

  return {
    canEditIdentity: identity,
    canEditPlanning: planning,
    canReassignRaidLead: reassign,
    canEdit: identity || planning || reassign,
    canOpen: canOpenRun(input.status),
    canCloseSignups: windowToggle && input.signupsOpen,
    canReopenSignups: windowToggle && !input.signupsOpen,
    canCancel: canCancelRun(input.status),
    canStart: canStartRun(input.status),
    canManageAttendance: canManageAttendance(input.status),
    canComplete: canCompleteRun(input.status),
  };
}
