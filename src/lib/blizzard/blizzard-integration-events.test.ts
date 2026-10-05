import { describe, expect, it } from "vitest";
import {
  blizzardOperationFromContext,
  classifyBlizzardHttpFailure,
  scheduledSyncPassStatus,
  shouldRecordBlizzardBoundaryFailure,
  type ScheduledSyncPassSnapshot,
} from "@/lib/blizzard/blizzard-integration-events";

function result(partial: Partial<ScheduledSyncPassSnapshot>): ScheduledSyncPassSnapshot {
  return {
    status: "COMPLETED",
    totalCandidates: 0,
    refreshed: 0,
    failed: 0,
    profileUnavailable: 0,
    rateLimited: 0,
    skippedInProgress: 0,
    skippedBackoff: 0,
    durationMs: 10,
    ...partial,
  };
}

describe("blizzard integration event helpers", () => {
  it("maps API contexts to operation names", () => {
    expect(blizzardOperationFromContext("client-credentials")).toBe("CLIENT_CREDENTIALS");
    expect(blizzardOperationFromContext("character-summary")).toBe("CHARACTER_SUMMARY");
    expect(blizzardOperationFromContext("character-raid-encounters")).toBe("RAID_ENCOUNTERS");
  });

  it("skips per-character 404 telemetry but keeps auth/rate-limit/upstream", () => {
    expect(
      shouldRecordBlizzardBoundaryFailure({
        context: "character-summary",
        httpStatus: 404,
        errorCode: "HTTP_404",
      }),
    ).toBe(false);
    expect(
      shouldRecordBlizzardBoundaryFailure({
        context: "character-status",
        httpStatus: 429,
        errorCode: "HTTP_429",
      }),
    ).toBe(true);
    expect(
      shouldRecordBlizzardBoundaryFailure({
        context: "client-credentials",
        httpStatus: 401,
        errorCode: "HTTP_401",
      }),
    ).toBe(true);
    expect(
      shouldRecordBlizzardBoundaryFailure({
        context: "character-summary",
        httpStatus: null,
        errorCode: "TIMEOUT",
      }),
    ).toBe(true);
  });

  it("classifies HTTP failures into distinct codes", () => {
    expect(classifyBlizzardHttpFailure(401)).toEqual({ errorCode: "HTTP_401", status: "ERROR" });
    expect(classifyBlizzardHttpFailure(403)).toEqual({ errorCode: "HTTP_403", status: "ERROR" });
    expect(classifyBlizzardHttpFailure(404)).toEqual({ errorCode: "HTTP_404", status: "WARNING" });
    expect(classifyBlizzardHttpFailure(429)).toEqual({ errorCode: "HTTP_429", status: "WARNING" });
    expect(classifyBlizzardHttpFailure(503)).toEqual({ errorCode: "HTTP_503", status: "ERROR" });
  });

  it("derives SCHEDULED_SYNC_PASS status from counters", () => {
    expect(scheduledSyncPassStatus(result({}))).toBe("SUCCESS");
    expect(scheduledSyncPassStatus(result({ failed: 1 }))).toBe("WARNING");
    expect(scheduledSyncPassStatus(result({ rateLimited: 2 }))).toBe("WARNING");
    expect(scheduledSyncPassStatus(result({ status: "SKIPPED_ALREADY_RUNNING" }))).toBe("WARNING");
  });
});
