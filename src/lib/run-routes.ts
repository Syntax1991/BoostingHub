import type { RunStatus } from "@/models/enums";

/**
 * Canonical Run entity URL. Future Discord/notification links should use this
 * path, not a /manage-only URL.
 */
/**
 * "consumables" is only rendered when the viewer's payload carries the audit
 * (ADMIN / the Run's RAID_LEAD); for anyone else it falls back to Overview.
 */
export const RUN_DETAIL_TABS = ["overview", "signups", "roster", "attendance", "payout", "consumables"] as const;

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
    value === "signups" ||
    value === "roster" ||
    value === "attendance" ||
    value === "payout" ||
    value === "consumables"
  ) {
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
