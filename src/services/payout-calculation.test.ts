import { describe, expect, it } from "vitest";
import { formatGold } from "@/lib/gold";
import { isDomainError } from "@/lib/errors";
import {
  allocateGold,
  calculateSettlementPool,
  splitGrossPot,
} from "@/services/payout-calculation";
import {
  ADVERTISER_CUT_BPS,
  BOOSTER_CUT_BPS,
  DAWN_CUT_BPS,
  RAID_LEAD_CUT_BPS,
  defaultShareUnits,
  formatPayoutCut,
} from "@/services/payout-state";

describe("formatGold", () => {
  it("formats whole gold with ASCII grouping", () => {
    expect(formatGold(0)).toBe("0g");
    expect(formatGold(151000)).toBe("151,000g");
    expect(formatGold(1001)).toBe("1,001g");
  });
});

describe("formatPayoutCut", () => {
  it("formats share units as Cuts", () => {
    expect(formatPayoutCut(0)).toBe("0 Cuts");
    expect(formatPayoutCut(50)).toBe("0.50 Cut");
    expect(formatPayoutCut(100)).toBe("1.00 Cut");
    expect(formatPayoutCut(150)).toBe("1.50 Cuts");
  });
});

describe("defaultShareUnits", () => {
  it("maps BOOSTER attendance statuses to the v1 defaults", () => {
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "PRESENT" })).toBe(100);
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "LATE" })).toBe(100);
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "LEFT_EARLY" })).toBe(100);
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "NO_SHOW" })).toBe(0);
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "EXCUSED" })).toBe(0);
    expect(defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "STANDBY" })).toBe(0);
  });

  it("defaults LOOTBUDDY to 0 regardless of attendance or mode", () => {
    expect(defaultShareUnits({ participationType: "LOOTBUDDY", attendanceStatus: "PRESENT" })).toBe(0);
    expect(defaultShareUnits({ participationType: "LOOTBUDDY", attendanceStatus: "LATE" })).toBe(0);
    expect(defaultShareUnits({ participationType: "LOOTBUDDY", attendanceStatus: "LEFT_EARLY" })).toBe(0);
  });

  it("rejects UNMARKED", () => {
    try {
      defaultShareUnits({ participationType: "BOOSTER", attendanceStatus: "UNMARKED" });
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_ATTENDANCE_INVALID");
    }
  });
});

describe("splitGrossPot", () => {
  it("splits 5,000,000 into exact Dawn raid buckets", () => {
    const result = splitGrossPot(5_000_000);
    expect(result.boosterCutBps).toBe(BOOSTER_CUT_BPS);
    expect(result.raidLeadCutBps).toBe(RAID_LEAD_CUT_BPS);
    expect(result.advertiserCutBps).toBe(ADVERTISER_CUT_BPS);
    expect(result.dawnCutBps).toBe(DAWN_CUT_BPS);
    expect(result.boosterBaseGold).toBe(3_125_000);
    expect(result.raidLeadCutGold).toBe(150_000);
    expect(result.advertiserCutGold).toBe(1_500_000);
    expect(result.dawnCutGold).toBe(225_000);
    expect(
      result.boosterBaseGold + result.raidLeadCutGold + result.advertiserCutGold + result.dawnCutGold,
    ).toBe(5_000_000);
  });

  it("uses floor on named buckets and gives Dawn the residual", () => {
    const result = splitGrossPot(1_001);
    expect(result.boosterBaseGold).toBe(Math.floor((1_001 * BOOSTER_CUT_BPS) / 10_000));
    expect(result.raidLeadCutGold).toBe(Math.floor((1_001 * RAID_LEAD_CUT_BPS) / 10_000));
    expect(result.advertiserCutGold).toBe(Math.floor((1_001 * ADVERTISER_CUT_BPS) / 10_000));
    expect(result.dawnCutGold).toBe(
      1_001 - result.boosterBaseGold - result.raidLeadCutGold - result.advertiserCutGold,
    );
    expect(
      result.boosterBaseGold + result.raidLeadCutGold + result.advertiserCutGold + result.dawnCutGold,
    ).toBe(1_001);
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

  it("rejects zero eligible shares when pool is positive", () => {
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

describe("calculateSettlementPool Dawn model", () => {
  const twentyBoosters = Array.from({ length: 20 }, (_, i) => ({
    attendanceId: `att-${String(i).padStart(2, "0")}`,
    shareUnits: 100,
  }));

  it("KEEP 5m with 20 full Cuts: 156,250 each and dedicated RL 150,000", () => {
    const result = calculateSettlementPool({
      totalGold: 5_000_000,
      raidLeadCutMode: "KEEP",
      entries: twentyBoosters,
    });
    expect(result.boosterBaseGold).toBe(3_125_000);
    expect(result.raidLeadCutGold).toBe(150_000);
    expect(result.advertiserCutGold).toBe(1_500_000);
    expect(result.dawnCutGold).toBe(225_000);
    expect(result.distributableBoosterPool).toBe(3_125_000);
    expect(result.dedicatedRaidLeadPayout).toBe(150_000);
    expect(result.raidLeadSharedGold).toBe(0);
    expect(result.attendancePayouts.every((row) => row.amountGold === 156_250)).toBe(true);
    expect(result.attendanceDistributedGold).toBe(3_125_000);
    expect(result.totalAllocatedGold).toBe(3_275_000);
  });

  it("SHARE 5m with 20 full Cuts: 163,750 each and dedicated RL 0", () => {
    const result = calculateSettlementPool({
      totalGold: 5_000_000,
      raidLeadCutMode: "SHARE",
      entries: twentyBoosters,
    });
    expect(result.boosterBaseGold).toBe(3_125_000);
    expect(result.raidLeadCutGold).toBe(150_000);
    expect(result.raidLeadSharedGold).toBe(150_000);
    expect(result.dedicatedRaidLeadPayout).toBe(0);
    expect(result.distributableBoosterPool).toBe(3_275_000);
    expect(result.advertiserCutGold).toBe(1_500_000);
    expect(result.dawnCutGold).toBe(225_000);
    expect(result.attendancePayouts.every((row) => row.amountGold === 163_750)).toBe(true);
    expect(result.attendanceDistributedGold).toBe(3_275_000);
    expect(result.totalAllocatedGold).toBe(3_275_000);
  });

  it("Lootbuddy zero share stays at 0 while Boosters split the pool", () => {
    const result = calculateSettlementPool({
      totalGold: 5_000_000,
      raidLeadCutMode: "KEEP",
      entries: [
        ...twentyBoosters,
        { attendanceId: "loot-present", shareUnits: 0 },
      ],
    });
    expect(result.attendancePayouts.find((row) => row.attendanceId === "loot-present")?.amountGold).toBe(0);
    expect(result.attendancePayouts.filter((row) => row.shareUnits === 100).every((row) => row.amountGold === 156_250)).toBe(
      true,
    );
  });

  it("manual Lootbuddy override to 100 participates in the Booster Pool", () => {
    const result = calculateSettlementPool({
      totalGold: 5_000_000,
      raidLeadCutMode: "KEEP",
      entries: [
        { attendanceId: "boost-a", shareUnits: 100 },
        { attendanceId: "loot-paid", shareUnits: 100 },
      ],
    });
    expect(result.distributableBoosterPool).toBe(3_125_000);
    expect(result.attendancePayouts.every((row) => row.amountGold === 1_562_500)).toBe(true);
  });

  it("rejects zero eligible shares when the Booster Pool is positive", () => {
    try {
      calculateSettlementPool({
        totalGold: 5_000_000,
        raidLeadCutMode: "KEEP",
        entries: [
          { attendanceId: "zero-a", shareUnits: 0 },
          { attendanceId: "zero-b", shareUnits: 0 },
        ],
      });
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("PAYOUT_NO_ELIGIBLE_SHARES");
    }
  });
});
