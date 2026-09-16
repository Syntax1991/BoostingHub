import { describe, expect, it } from "vitest";
import {
  assertValidAvailabilityInterval,
  findBlockingAvailabilityBlock,
  isAvailabilityBlockCurrentOrUpcoming,
  runStartFallsInAvailabilityBlock,
} from "@/lib/character-availability";

const block = {
  startsAt: "2026-09-18T16:00:00.000Z", // 18:00 Berlin (CEST = UTC+2)
  endsAt: "2026-09-18T19:00:00.000Z", // 21:00 Berlin
};

describe("character availability interval", () => {
  it("uses half-open [startsAt, endsAt) against the Run start", () => {
    expect(runStartFallsInAvailabilityBlock("2026-09-18T15:59:59.000Z", block)).toBe(false);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T16:00:00.000Z", block)).toBe(true);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T18:59:59.000Z", block)).toBe(true);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T19:00:00.000Z", block)).toBe(false);
  });

  it("rejects invalid or zero-duration intervals", () => {
    expect(() => assertValidAvailabilityInterval(block.startsAt, block.startsAt)).toThrow(/after start/);
    expect(() => assertValidAvailabilityInterval(block.endsAt, block.startsAt)).toThrow(/after start/);
    expect(() => assertValidAvailabilityInterval("not-a-date", block.endsAt)).toThrow(/valid ISO/);
  });

  it("finds the first blocking block among multiple overlapping entries", () => {
    const blocks = [
      { id: "a", startsAt: "2026-09-18T10:00:00.000Z", endsAt: "2026-09-18T12:00:00.000Z" },
      { id: "b", ...block },
      { id: "c", startsAt: "2026-09-18T16:30:00.000Z", endsAt: "2026-09-18T20:00:00.000Z" },
    ];
    expect(findBlockingAvailabilityBlock("2026-09-18T17:00:00.000Z", blocks)?.id).toBe("b");
    expect(findBlockingAvailabilityBlock("2026-09-18T11:00:00.000Z", blocks)?.id).toBe("a");
    expect(findBlockingAvailabilityBlock("2026-09-18T21:00:00.000Z", blocks)).toBeNull();
  });

  it("treats past blocks as historical once endsAt has passed", () => {
    expect(isAvailabilityBlockCurrentOrUpcoming(block, "2026-09-18T18:59:59.000Z")).toBe(true);
    expect(isAvailabilityBlockCurrentOrUpcoming(block, "2026-09-18T19:00:00.000Z")).toBe(false);
  });
});
