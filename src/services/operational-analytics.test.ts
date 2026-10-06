import { describe, expect, it } from "vitest";
import {
  aggregateOperationalAnalytics,
  type OperationalAnalyticsRunRow,
} from "@/services/operational-analytics";

function row(partial: Partial<OperationalAnalyticsRunRow> & { id: string }): OperationalAnalyticsRunRow {
  return {
    status: "COMPLETED",
    difficulty: "HEROIC",
    lootType: "SAVED",
    scheduledStartAt: "2026-10-01T19:00:00.000Z",
    scheduleRevision: 0,
    activeSignupCount: 10,
    selectedSignupCount: 8,
    externalBoosterCount: 0,
    noShowCount: 0,
    markedAttendanceCount: 8,
    ...partial,
  };
}

describe("aggregateOperationalAnalytics", () => {
  const range = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", days: 30 };

  it("aggregates high-confidence operational metrics without inventing rates on empty denominators", () => {
    const report = aggregateOperationalAnalytics([], range);
    expect(report.totalRuns).toBe(0);
    expect(report.signupToSelectedRate).toBeNull();
    expect(report.noShowRate).toBeNull();
    expect(report.externalShareOfStaffing).toBeNull();
  });

  it("computes cancellations, reschedules, external share, and no-show rate", () => {
    const report = aggregateOperationalAnalytics(
      [
        row({
          id: "1",
          status: "COMPLETED",
          activeSignupCount: 20,
          selectedSignupCount: 10,
          externalBoosterCount: 2,
          noShowCount: 1,
          markedAttendanceCount: 10,
        }),
        row({
          id: "2",
          status: "CANCELLED",
          scheduleRevision: 2,
          difficulty: "MYTHIC",
          lootType: "COMMUNITY",
          activeSignupCount: 5,
          selectedSignupCount: 0,
          externalBoosterCount: 0,
          noShowCount: 0,
          markedAttendanceCount: 0,
        }),
      ],
      range,
    );
    expect(report.totalRuns).toBe(2);
    expect(report.cancellations).toBe(1);
    expect(report.reschedules).toBe(1);
    expect(report.byDifficulty).toEqual({ HEROIC: 1, MYTHIC: 1 });
    expect(report.byLootType).toEqual({ SAVED: 1, COMMUNITY: 1 });
    expect(report.signupToSelectedRate).toBe(0.4);
    expect(report.runsWithExternalBoosters).toBe(1);
    expect(report.externalShareOfStaffing).toBe(rateish(2, 12));
    expect(report.noShowRate).toBe(0.1);
  });
});

function rateish(n: number, d: number) {
  return Math.round((n / d) * 1000) / 1000;
}
