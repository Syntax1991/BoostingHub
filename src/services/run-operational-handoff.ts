import type { RunStatus } from "@/models/enums";
import type { RunDetailTab } from "@/lib/run-routes";
import type { RunLifecycleCapabilities } from "@/services/run-state";

export type RunOperationalAttention =
  | "NONE"
  | "NEEDS_ATTENDANCE"
  | "READY_TO_COMPLETE";

export type RunOperationalActionKind =
  | "MANAGE"
  | "BUILD_ROSTER"
  | "CONTINUE_ROSTER"
  | "VIEW_ROSTER"
  | "START"
  | "ATTENDANCE"
  | "COMPLETE"
  | "VIEW";

export type RunOperationalActionMode =
  | "link"
  | "dialog-start"
  | "dialog-complete";

export type RunOperationalAction = {
  kind: RunOperationalActionKind;
  label: string;
  mode: RunOperationalActionMode;
  tab?: RunDetailTab;
};

export type RunAttendanceSummary = {
  total: number;
  unmarkedCount: number;
};

export type RunOperationalHandoff = {
  attendance: RunAttendanceSummary;
  attention: RunOperationalAttention;
  nextAction: RunOperationalAction;
};

function emptyAttendance(): RunAttendanceSummary {
  return { total: 0, unmarkedCount: 0 };
}

/**
 * Derived operational handoff for Manage Runs / hub attention.
 * Not persisted. Uses real attendance and Run lifecycle capabilities; a COMPLETED
 * Run is done (BoostingHub has no financial follow-up).
 */
export function projectRunOperationalHandoff(input: {
  status: RunStatus;
  hasRoster: boolean;
  publishedAt: string | null;
  draftSelectedCount: number;
  capabilities: RunLifecycleCapabilities;
  attendance: RunAttendanceSummary | null;
}): RunOperationalHandoff {
  const attendance = input.attendance ?? emptyAttendance();

  if (input.status === "DRAFT") {
    return {
      attendance,
      attention: "NONE",
      nextAction: { kind: "MANAGE", label: "Manage", mode: "link", tab: "overview" },
    };
  }

  if (input.status === "OPEN") {
    const continueRoster = input.hasRoster && input.draftSelectedCount > 0;
    return {
      attendance,
      attention: "NONE",
      nextAction: continueRoster
        ? {
            kind: "CONTINUE_ROSTER",
            label: "Continue Roster",
            mode: "link",
            tab: "roster",
          }
        : {
            kind: "BUILD_ROSTER",
            label: "Build Roster",
            mode: "link",
            tab: "roster",
          },
    };
  }

  if (input.status === "ROSTERING") {
    return {
      attendance,
      attention: "NONE",
      nextAction: {
        kind: "CONTINUE_ROSTER",
        label: "Continue Roster",
        mode: "link",
        tab: "roster",
      },
    };
  }

  if (input.status === "PUBLISHED") {
    if (input.capabilities.canStart) {
      return {
        attendance,
        attention: "NONE",
        nextAction: { kind: "START", label: "Start Run", mode: "dialog-start" },
      };
    }
    return {
      attendance,
      attention: "NONE",
      nextAction: {
        kind: "VIEW_ROSTER",
        label: "View/Edit Roster",
        mode: "link",
        tab: "roster",
      },
    };
  }

  if (input.status === "IN_PROGRESS") {
    if (attendance.unmarkedCount > 0) {
      return {
        attendance,
        attention: "NEEDS_ATTENDANCE",
        nextAction: {
          kind: "ATTENDANCE",
          label: "Mark Attendance",
          mode: "link",
          tab: "attendance",
        },
      };
    }
    return {
      attendance,
      attention: "READY_TO_COMPLETE",
      nextAction: {
        kind: "COMPLETE",
        label: "Complete Run",
        mode: "dialog-complete",
      },
    };
  }

  // COMPLETED and CANCELLED: nothing left to do.
  return {
    attendance,
    attention: "NONE",
    nextAction: { kind: "VIEW", label: "View", mode: "link", tab: "overview" },
  };
}

export function formatOperationalAttentionHint(handoff: RunOperationalHandoff): string | null {
  if (handoff.attention === "NEEDS_ATTENDANCE") {
    const n = handoff.attendance.unmarkedCount;
    return `${n} unmarked`;
  }
  if (handoff.attention === "READY_TO_COMPLETE") {
    return "Ready to complete";
  }
  return null;
}
