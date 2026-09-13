import { describe, expect, it } from "vitest";
import { formatGold } from "@/lib/gold";
import { isDomainError } from "@/lib/errors";
import {
  allocateGold,
  assertRaidLeadCutGold,
  calculateSettlementPool,
} from "@/services/payout-calculation";
import { defaultShareUnits } from "@/services/payout-state";

describe("formatGold", () => {
  it("formats whole gold with ASCII grouping", () => {
    expect(formatGold(0)).toBe("0g");
    expect(formatGold(151000)).toBe("151,000g");
    expect(formatGold(1001)).toBe("1,001g");
  });
});

describe("defaultShareUnits", () => {
  it("maps completed attendance statuses to the v1 defaults", () => {
    expect(defaultShareUnits("PRESENT")).toBe(100);
    expect(defaultShareUnits("LATE")).toBe(100);
    expect(defaultShareUnits("LEFT_EARLY")).toBe(100);
    expect(defaultShareUnits("NO_SHOW")).toBe(0);
    expect(defaultShareUnits("EXCUSED")).toBe(0);
    expect(defaultShareUnits("STANDBY")).toBe(0);
  });

  it("rejects UNMARKED", () => {
    try {
      defaultShareUnits("UNMARKED");
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_ATTENDANCE_INVALID");
    }
  });
});

describe("allocateGold", () => {
  it("splits equal shares and keeps zero-share rows", () => {
    const result = allocateGold(900, [
      { attendanceId: "a", shareUnits: 100 },
      { attendanceId: "b", shareUnits: 100 },
      { attendanceId: "c", shareUnits: 100 },
      { attendanceId: "d", shareUnits: 0 },
    ]);
    expect(result.map((row) => row.amountGold)).toEqual([300, 300, 300, 0]);
    expect(result.reduce((sum, row) => sum + row.amountGold, 0)).toBe(900);
  });

  it("uses integer floors then remainder in attendanceId order for 1001", () => {
    const result = allocateGold(1001, [
      { attendanceId: "att-a", shareUnits: 100 },
      { attendanceId: "att-b", shareUnits: 100 },
      { attendanceId: "att-c", shareUnits: 50 },
      { attendanceId: "att-d", shareUnits: 0 },
    ]);
    const byId = Object.fromEntries(result.map((row) => [row.attendanceId, row.amountGold]));
    expect(byId["att-a"]).toBe(401);
    expect(byId["att-b"]).toBe(400);
    expect(byId["att-c"]).toBe(200);
    expect(byId["att-d"]).toBe(0);
    expect(result.reduce((sum, row) => sum + row.amountGold, 0)).toBe(1001);
  });

  it("is independent of input order", () => {
    const first = allocateGold(1001, [
      { attendanceId: "att-d", shareUnits: 0 },
      { attendanceId: "att-c", shareUnits: 50 },
      { attendanceId: "att-b", shareUnits: 100 },
      { attendanceId: "att-a", shareUnits: 100 },
    ]);
    const second = allocateGold(1001, [
      { attendanceId: "att-a", shareUnits: 100 },
      { attendanceId: "att-b", shareUnits: 100 },
      { attendanceId: "att-c", shareUnits: 50 },
      { attendanceId: "att-d", shareUnits: 0 },
    ]);
    expect(Object.fromEntries(first.map((row) => [row.attendanceId, row.amountGold]))).toEqual(
      Object.fromEntries(second.map((row) => [row.attendanceId, row.amountGold])),
    );
  });

  it("handles weighted shares, tiny totals, and larger totals", () => {
    const tiny = allocateGold(1, [
      { attendanceId: "m", shareUnits: 100 },
      { attendanceId: "n", shareUnits: 100 },
    ]);
    expect(tiny.reduce((sum, row) => sum + row.amountGold, 0)).toBe(1);
    expect(tiny.find((row) => row.attendanceId === "m")?.amountGold).toBe(1);
    expect(tiny.find((row) => row.attendanceId === "n")?.amountGold).toBe(0);

    const large = allocateGold(1_000_000, [
      { attendanceId: "x", shareUnits: 200 },
      { attendanceId: "y", shareUnits: 100 },
    ]);
    expect(large.find((row) => row.attendanceId === "x")?.amountGold).toBe(666667);
    expect(large.find((row) => row.attendanceId === "y")?.amountGold).toBe(333333);
    expect(large.reduce((sum, row) => sum + row.amountGold, 0)).toBe(1_000_000);
  });

  it("rejects zero eligible shares", () => {
    try {
      allocateGold(100, [
        { attendanceId: "a", shareUnits: 0 },
        { attendanceId: "b", shareUnits: 0 },
      ]);
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_NO_ELIGIBLE_SHARES");
    }
  });
});

describe("assertRaidLeadCutGold", () => {
  it("rejects negative, equal, and greater-than pot cuts", () => {
    try {
      assertRaidLeadCutGold(-1, 1000);
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_INVALID_RAID_LEAD_CUT");
    }
    try {
      assertRaidLeadCutGold(1000, 1000);
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_INVALID_RAID_LEAD_CUT");
    }
    try {
      assertRaidLeadCutGold(1001, 1000);
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_INVALID_RAID_LEAD_CUT");
    }
  });

  it("allows zero cut", () => {
    expect(assertRaidLeadCutGold(0, 1450000)).toBe(0);
  });
});

describe("calculateSettlementPool", () => {
  const twoPresent = [
    { attendanceId: "att-a", shareUnits: 100 },
    { attendanceId: "att-b", shareUnits: 100 },
  ];

  it("KEEP basic: deducts dedicated cut and conserves totalGold", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 50_000,
      entries: twoPresent,
    });
    expect(result.declaredRaidLeadCut).toBe(50_000);
    expect(result.dedicatedRaidLeadPayout).toBe(50_000);
    expect(result.distributablePool).toBe(1_400_000);
    expect(result.allocatedAttendanceGold).toBe(1_400_000);
    expect(result.totalAllocatedGold).toBe(1_450_000);
    expect(result.attendancePayouts.every((row) => row.amountGold === 700_000)).toBe(true);
  });

  it("SHARE basic: retains declared cut but does not deduct or pay it separately", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "SHARE",
      raidLeadCutGold: 50_000,
      entries: twoPresent,
    });
    expect(result.declaredRaidLeadCut).toBe(50_000);
    expect(result.dedicatedRaidLeadPayout).toBe(0);
    expect(result.distributablePool).toBe(1_450_000);
    expect(result.allocatedAttendanceGold).toBe(1_450_000);
    expect(result.totalAllocatedGold).toBe(1_450_000);
  });

  it("KEEP with cut 0 matches a full-pot allocation", () => {
    const result = calculateSettlementPool({
      totalGold: 900,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 0,
      entries: [
        { attendanceId: "a", shareUnits: 100 },
        { attendanceId: "b", shareUnits: 100 },
        { attendanceId: "c", shareUnits: 100 },
      ],
    });
    expect(result.dedicatedRaidLeadPayout).toBe(0);
    expect(result.distributablePool).toBe(900);
    expect(result.totalAllocatedGold).toBe(900);
  });

  it("KEEP preserves ordinary Raid Lead attendance share separately from dedicated cut", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 50_000,
      entries: [
        { attendanceId: "lead-att", shareUnits: 100 },
        { attendanceId: "booster-att", shareUnits: 100 },
      ],
    });
    const leadShare = result.attendancePayouts.find((row) => row.attendanceId === "lead-att")!.amountGold;
    expect(leadShare).toBe(700_000);
    expect(result.dedicatedRaidLeadPayout).toBe(50_000);
    expect(leadShare + result.dedicatedRaidLeadPayout).toBe(750_000);
    expect(result.allocatedAttendanceGold + result.dedicatedRaidLeadPayout).toBe(1_450_000);
  });

  it("KEEP still pays dedicated cut when Raid Lead has no attendance row", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 50_000,
      entries: [
        { attendanceId: "booster-a", shareUnits: 100 },
        { attendanceId: "booster-b", shareUnits: 100 },
      ],
    });
    expect(result.dedicatedRaidLeadPayout).toBe(50_000);
    expect(result.distributablePool).toBe(1_400_000);
    expect(result.attendancePayouts).toHaveLength(2);
    expect(result.totalAllocatedGold).toBe(1_450_000);
  });

  it("SHARE with Raid Lead attendance pays ordinary share only", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "SHARE",
      raidLeadCutGold: 50_000,
      entries: [
        { attendanceId: "lead-att", shareUnits: 100 },
        { attendanceId: "booster-att", shareUnits: 100 },
      ],
    });
    const leadShare = result.attendancePayouts.find((row) => row.attendanceId === "lead-att")!.amountGold;
    expect(result.dedicatedRaidLeadPayout).toBe(0);
    expect(leadShare).toBe(725_000);
  });

  it("SHARE with Raid Lead absent pays zero dedicated cut", () => {
    const result = calculateSettlementPool({
      totalGold: 1_450_000,
      raidLeadCutMode: "SHARE",
      raidLeadCutGold: 50_000,
      entries: [{ attendanceId: "booster-only", shareUnits: 100 }],
    });
    expect(result.dedicatedRaidLeadPayout).toBe(0);
    expect(result.allocatedAttendanceGold).toBe(1_450_000);
  });

  it("keeps zero-share rows, weighted shares, and same-user multiple attendance", () => {
    const result = calculateSettlementPool({
      totalGold: 1_001,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 1,
      entries: [
        { attendanceId: "att-a", shareUnits: 100 },
        { attendanceId: "att-b", shareUnits: 100 },
        { attendanceId: "att-c", shareUnits: 50 },
        { attendanceId: "att-d", shareUnits: 0 },
        { attendanceId: "att-e", shareUnits: 100 },
      ],
    });
    expect(result.distributablePool).toBe(1_000);
    expect(result.dedicatedRaidLeadPayout).toBe(1);
    expect(result.allocatedAttendanceGold + result.dedicatedRaidLeadPayout).toBe(1_001);
    expect(result.attendancePayouts.find((row) => row.attendanceId === "att-d")?.amountGold).toBe(0);
    // same user can own att-a and att-e conceptually; amounts stay per attendanceId
    expect(result.attendancePayouts.filter((row) => row.shareUnits > 0)).toHaveLength(4);
  });

  it("characterless lootbuddy attendance still allocates from the pool", () => {
    const result = calculateSettlementPool({
      totalGold: 200,
      raidLeadCutMode: "SHARE",
      raidLeadCutGold: 20,
      entries: [
        { attendanceId: "lootbuddy-no-char", shareUnits: 100 },
        { attendanceId: "booster", shareUnits: 100 },
      ],
    });
    expect(result.distributablePool).toBe(200);
    expect(result.attendancePayouts.find((row) => row.attendanceId === "lootbuddy-no-char")?.amountGold).toBe(100);
  });

  it("uses deterministic remainder against the KEEP pool", () => {
    const result = calculateSettlementPool({
      totalGold: 1_004,
      raidLeadCutMode: "KEEP",
      raidLeadCutGold: 3,
      entries: [
        { attendanceId: "att-a", shareUnits: 100 },
        { attendanceId: "att-b", shareUnits: 100 },
        { attendanceId: "att-c", shareUnits: 50 },
      ],
    });
    expect(result.distributablePool).toBe(1_001);
    const byId = Object.fromEntries(result.attendancePayouts.map((row) => [row.attendanceId, row.amountGold]));
    expect(byId["att-a"]).toBe(401);
    expect(byId["att-b"]).toBe(400);
    expect(byId["att-c"]).toBe(200);
    expect(result.totalAllocatedGold).toBe(1_004);
  });
});
