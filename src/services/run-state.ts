import type { RaidDifficulty, RunLootType, RunStatus } from "@/models/enums";
import { UPCOMING_RUN_STATUSES } from "@/models/enums";
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
/** Archive is administrative state, not a RunStatus — only a terminal Run may be archived. */
const ARCHIVABLE_STATUSES: readonly RunStatus[] = ["COMPLETED", "CANCELLED"];

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

/**
 * A Character offered/selected on a Run in one of these statuses still
 * occupies a real scheduling slot, for cross-Run Character reservation —
 * the same status set as "upcoming" operational Runs (UPCOMING_RUN_STATUSES):
 * DRAFT has no signups yet, and COMPLETED/CANCELLED are terminal and never
 * block a future Run. A separate concern from raid lockouts.
 */
export function isReservationBlockingRunStatus(status: RunStatus): boolean {
  return UPCOMING_RUN_STATUSES.includes(status);
}

/**
 * Authoritative Difficulty x LootType compatibility. MYTHIC cannot be SAVED —
 * every other combination is allowed. This is the single source of truth for
 * Create, Edit, the future Mass Create feature, Discord naming, and tests.
 */
export function isLootTypeAllowedForDifficulty(
  difficulty: RaidDifficulty,
  lootType: RunLootType,
): boolean {
  if (difficulty === "MYTHIC" && lootType === "SAVED") return false;
  return true;
}

export function assertValidRunLootType(difficulty: RaidDifficulty, lootType: RunLootType): void {
  if (!isLootTypeAllowedForDifficulty(difficulty, lootType)) {
    throw new DomainError(
      "RUN_LOOT_TYPE_INVALID",
      "Saved runs are not available for Mythic difficulty.",
    );
  }
}

/** 1 <= plannedBossCount <= the raid's total boss count (RaidBoss row count). */
export function assertValidPlannedBossCount(plannedBossCount: number, totalBossCount: number): void {
  if (!Number.isInteger(plannedBossCount) || plannedBossCount < 1 || plannedBossCount > totalBossCount) {
    throw new DomainError(
      "RUN_BOSS_COUNT_INVALID",
      `Planned boss count must be between 1 and ${totalBossCount}.`,
    );
  }
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
  canArchive: boolean;
  canRestore: boolean;
  canDelete: boolean;
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
    canArchive: false,
    canRestore: false,
    canDelete: false,
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

/** Only a terminal (COMPLETED/CANCELLED) Run not already archived may be archived. */
export function canArchiveRun(status: RunStatus, archivedAt: string | null): boolean {
  return ARCHIVABLE_STATUSES.includes(status) && !archivedAt;
}

export function canRestoreRun(archivedAt: string | null): boolean {
  return Boolean(archivedAt);
}

/**
 * Visibility only — the actual delete blocks on real relation history, which
 * requires DB access this pure function does not have. The Service remains
 * authoritative; this only decides whether to render the button at all.
 */
export function canDeleteRun(status: RunStatus, actorIsAdmin: boolean): boolean {
  return actorIsAdmin && status === "DRAFT";
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
  archivedAt?: string | null;
}): RunLifecycleCapabilities {
  const identity = canEditIdentityFields(input.status, input.hasSignupHistory);
  const planning = canEditPlanningFields(input.status);
  const reassign = canReassignRaidLead(input.status, input.actorIsAdmin);
  const windowToggle = canToggleSignupWindow(input.status);
  const archivedAt = input.archivedAt ?? null;

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
    canArchive: canArchiveRun(input.status, archivedAt),
    canRestore: canRestoreRun(archivedAt),
    canDelete: canDeleteRun(input.status, input.actorIsAdmin),
  };
}
