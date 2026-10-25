import type { RunStatus } from "@/models/enums";

/**
 * Canonical Run entity URL. Future Discord/notification links should use this
 * path, not a /manage-only URL.
 */
/**
 * Primary tabs: Roster (ops workspace), Operations, Attendance, History.
 * "signups" is a legacy alias for Roster. "overview" redirects to Operations.
 * "consumables" remains for managers with audit payload.
 */
export const RUN_DETAIL_TABS = [
  "roster",
  "operations",
  "attendance",
  "history",
  "overview",
  "signups",
  "consumables",
] as const;

export type RunDetailTab = (typeof RUN_DETAIL_TABS)[number];

/** Canonical Create Run workflow (1–25 drafts). Legacy /manage/runs/create redirects here. */
export const RUN_CREATE_PATH = "/runs/create";

export function runCreatePath(): string {
  return RUN_CREATE_PATH;
}

/**
 * Post-submit destination after createManyRunsAction succeeds.
 * One draft → canonical detail; multiple drafts → Manage Runs mass-created banner.
 */
export function runCreateSuccessPath(runIds: string[]): string {
  if (runIds.length === 1) {
    return runDetailPath(runIds[0]!);
  }
  if (runIds.length > 1) {
    return `/manage/runs?massCreated=${runIds.length}`;
  }
  return "/runs";
}

export function parseRunDetailTab(value: unknown): RunDetailTab {
  if (Array.isArray(value)) {
    return parseRunDetailTab(value[0]);
  }
  if (
    value === "roster" ||
    value === "operations" ||
    value === "attendance" ||
    value === "history" ||
    value === "overview" ||
    value === "signups" ||
    value === "consumables"
  ) {
    return value;
  }
  return "roster";
}

/** Normalize legacy / alias tabs to the tab the UI actually selects. */
export function resolveRunDetailTab(tab: RunDetailTab, hasConsumables: boolean): RunDetailTab {
  if (tab === "consumables" && !hasConsumables) return "roster";
  if (tab === "signups") return "roster";
  if (tab === "overview") return "operations";
  return tab;
}

export function runDetailPath(runId: string, tab?: RunDetailTab): string {
  const base = `/runs/${runId}`;
  if (!tab || tab === "roster") {
    return base;
  }
  if (tab === "signups") {
    return base;
  }
  if (tab === "overview") {
    return `${base}?tab=operations`;
  }
  return `${base}?tab=${tab}`;
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
  if (status === "COMPLETED" || status === "CANCELLED") {
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
