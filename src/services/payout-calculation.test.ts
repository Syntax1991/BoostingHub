import { describe, expect, it } from "vitest";
import { formatGold } from "@/lib/gold";
import { isDomainError } from "@/lib/errors";
import { allocateGold } from "@/services/payout-calculation";
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
