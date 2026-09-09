import type { RunStatus } from "@/models/enums";

/**
 * Canonical Run entity URL. Future Discord/notification links should use this
 * path, not a /manage-only URL.
 */
export const RUN_DETAIL_TABS = ["overview", "signups", "roster", "attendance", "payout"] as const;

export type RunDetailTab = (typeof RUN_DETAIL_TABS)[number];

export function parseRunDetailTab(value: unknown): RunDetailTab {
  if (Array.isArray(value)) {
    return parseRunDetailTab(value[0]);
  }
  if (value === "signups" || value === "roster" || value === "attendance" || value === "payout") {
    return value;
  }
  return "overview";
}

export function runDetailPath(runId: string, tab?: RunDetailTab): string {
  const base = `/runs/${runId}`;
  if (!tab || tab === "overview") {
    return base;
  }
  return `${base}?tab=${tab}`;
}

/** Roster-oriented manage-index actions open the Roster tab; View/Manage stay on Overview. */
export function runDetailTabForManageAction(actionLabel: string): RunDetailTab {
  if (actionLabel === "View" || actionLabel === "Manage") {
    return "overview";
  }
  if (actionLabel === "Attendance") {
    return "attendance";
  }
  if (actionLabel === "Payout") {
    return "payout";
  }
  return "roster";
}

export function rosterActionLabel(
  status: RunStatus,
  hasRoster: boolean,
  publishedAt: string | null,
  draftCount: number,
): string {
  if (status === "DRAFT") {
    return "Manage";
  }
  if (status === "IN_PROGRESS") {
    return "Attendance";
  }
  if (status === "COMPLETED") {
    return "Payout";
  }
  if (status === "CANCELLED") {
    return "View";
  }
  if (publishedAt) {
    return "View/Edit Roster";
  }
  if (hasRoster && draftCount > 0) {
    return "Continue Roster";
  }
  if (status === "ROSTERING") {
    return "Continue Roster";
  }
  return "Build Roster";
}
