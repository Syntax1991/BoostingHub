import type { RaidDifficulty, RunLootType, RunStatus } from "@/models/enums";

export type OperationalAnalyticsRunRow = {
  id: string;
  status: RunStatus;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  scheduleRevision: number;
  /** Non-withdrawn signups. */
  activeSignupCount: number;
  /** Signups currently SELECTED. */
  selectedSignupCount: number;
  externalBoosterCount: number;
  /** Attendance rows marked NO_SHOW. */
  noShowCount: number;
  /** Attendance rows with a terminal mark (PRESENT / LATE / NO_SHOW / BENCH). */
  markedAttendanceCount: number;
};

export type OperationalAnalyticsReport = {
  range: { from: string; to: string; days: number };
  totalRuns: number;
  byStatus: Record<string, number>;
  byDifficulty: Record<string, number>;
  byLootType: Record<string, number>;
  activeSignups: number;
  selectedSignups: number;
  signupToSelectedRate: number | null;
  cancellations: number;
  reschedules: number;
  runsWithExternalBoosters: number;
  externalBoosterSlots: number;
  publishedSelectedSlots: number;
  externalShareOfStaffing: number | null;
  noShows: number;
  markedAttendance: number;
  noShowRate: number | null;
};

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * Pure aggregation of durable Run operational rows.
 * No financial fields. Timing metrics that need audit history are omitted.
 */
export function aggregateOperationalAnalytics(
  rows: OperationalAnalyticsRunRow[],
  range: { from: string; to: string; days: number },
): OperationalAnalyticsReport {
  const byStatus: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  const byLootType: Record<string, number> = {};
  let activeSignups = 0;
  let selectedSignups = 0;
  let cancellations = 0;
  let reschedules = 0;
  let runsWithExternalBoosters = 0;
  let externalBoosterSlots = 0;
  let publishedSelectedSlots = 0;
  let noShows = 0;
  let markedAttendance = 0;

  for (const row of rows) {
    bump(byStatus, row.status);
    bump(byDifficulty, row.difficulty);
    bump(byLootType, row.lootType);
    activeSignups += row.activeSignupCount;
    selectedSignups += row.selectedSignupCount;
    if (row.status === "CANCELLED") cancellations += 1;
    if (row.scheduleRevision > 0) reschedules += 1;
    if (row.externalBoosterCount > 0) runsWithExternalBoosters += 1;
    externalBoosterSlots += row.externalBoosterCount;
    publishedSelectedSlots += row.selectedSignupCount + row.externalBoosterCount;
    noShows += row.noShowCount;
    markedAttendance += row.markedAttendanceCount;
  }

  return {
    range,
    totalRuns: rows.length,
    byStatus,
    byDifficulty,
    byLootType,
    activeSignups,
    selectedSignups,
    signupToSelectedRate: rate(selectedSignups, activeSignups),
    cancellations,
    reschedules,
    runsWithExternalBoosters,
    externalBoosterSlots,
    publishedSelectedSlots,
    externalShareOfStaffing: rate(externalBoosterSlots, publishedSelectedSlots),
    noShows,
    markedAttendance,
    noShowRate: rate(noShows, markedAttendance),
  };
}
