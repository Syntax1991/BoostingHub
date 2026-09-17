import type { RunStatus, SettlementStatus } from "@/models/enums";
import type { RunDetailTab } from "@/lib/run-routes";
import type { RunLifecycleCapabilities } from "@/services/run-state";

export type RunOperationalAttention =
  | "NONE"
  | "NEEDS_ATTENDANCE"
  | "READY_TO_COMPLETE"
  | "NEEDS_SETTLEMENT"
  | "SETTLED";

export type RunOperationalActionKind =
  | "MANAGE"
  | "BUILD_ROSTER"
  | "CONTINUE_ROSTER"
  | "VIEW_ROSTER"
  | "START"
  | "ATTENDANCE"
  | "COMPLETE"
  | "PREPARE_PAYOUT"
  | "REVIEW_PAYOUT"
  | "MARK_PAID"
  | "VIEW_PAYOUT"
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

export type RunSettlementStage = "NONE" | SettlementStatus;

export type RunOperationalHandoff = {
  attendance: RunAttendanceSummary;
  settlement: { stage: RunSettlementStage };
  attention: RunOperationalAttention;
  nextAction: RunOperationalAction;
};

function emptyAttendance(): RunAttendanceSummary {
  return { total: 0, unmarkedCount: 0 };
}

/**
 * Derived operational handoff for Manage Runs / hub attention.
 * Not persisted. Uses real attendance + settlement stage + actor payout capabilities.
 */
export function projectRunOperationalHandoff(input: {
  status: RunStatus;
  hasRoster: boolean;
  publishedAt: string | null;
  draftSelectedCount: number;
  capabilities: RunLifecycleCapabilities;
  attendance: RunAttendanceSummary | null;
  settlementStage: RunSettlementStage;
  canMarkPaid: boolean;
}): RunOperationalHandoff {
  const attendance = input.attendance ?? emptyAttendance();
  const settlementStage = input.settlementStage;

  if (input.status === "DRAFT") {
    return {
      attendance,
      settlement: { stage: settlementStage },
      attention: "NONE",
      nextAction: { kind: "MANAGE", label: "Manage", mode: "link", tab: "overview" },
    };
  }

  if (input.status === "OPEN") {
    const continueRoster = input.hasRoster && input.draftSelectedCount > 0;
    return {
      attendance,
      settlement: { stage: settlementStage },
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
      settlement: { stage: settlementStage },
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
        settlement: { stage: settlementStage },
        attention: "NONE",
        nextAction: { kind: "START", label: "Start Run", mode: "dialog-start" },
      };
    }
    return {
      attendance,
      settlement: { stage: settlementStage },
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
        settlement: { stage: settlementStage },
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
      settlement: { stage: settlementStage },
      attention: "READY_TO_COMPLETE",
      nextAction: {
        kind: "COMPLETE",
        label: "Complete Run",
        mode: "dialog-complete",
      },
    };
  }

  if (input.status === "COMPLETED") {
    if (settlementStage === "NONE") {
      return {
        attendance,
        settlement: { stage: settlementStage },
        attention: "NEEDS_SETTLEMENT",
        nextAction: {
          kind: "PREPARE_PAYOUT",
          label: "Prepare Payout",
          mode: "link",
          tab: "payout",
        },
      };
    }
    if (settlementStage === "DRAFT") {
      return {
        attendance,
        settlement: { stage: settlementStage },
        attention: "NEEDS_SETTLEMENT",
        nextAction: {
          kind: "REVIEW_PAYOUT",
          label: "Review Payout",
          mode: "link",
          tab: "payout",
        },
      };
    }
    if (settlementStage === "FINALIZED") {
      if (input.canMarkPaid) {
        return {
          attendance,
          settlement: { stage: settlementStage },
          attention: "NEEDS_SETTLEMENT",
          nextAction: {
            kind: "MARK_PAID",
            label: "Mark Paid",
            mode: "link",
            tab: "payout",
          },
        };
      }
      return {
        attendance,
        settlement: { stage: settlementStage },
        attention: "NEEDS_SETTLEMENT",
        nextAction: {
          kind: "VIEW_PAYOUT",
          label: "View Payout",
          mode: "link",
          tab: "payout",
        },
      };
    }
    // PAID
    return {
      attendance,
      settlement: { stage: settlementStage },
      attention: "SETTLED",
      nextAction: {
        kind: "VIEW_PAYOUT",
        label: "View Payout",
        mode: "link",
        tab: "payout",
      },
    };
  }

  // CANCELLED
  return {
    attendance,
    settlement: { stage: settlementStage },
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
  if (handoff.attention === "NEEDS_SETTLEMENT") {
    if (handoff.settlement.stage === "NONE") return "Needs payout";
    if (handoff.settlement.stage === "DRAFT") return "Settlement draft";
    if (handoff.settlement.stage === "FINALIZED") return "Settlement finalized";
  }
  if (handoff.attention === "SETTLED") {
    return "Paid";
  }
  return null;
}
