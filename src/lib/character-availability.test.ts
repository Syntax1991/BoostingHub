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

  it("selects among covering blocks by startsAt then endsAt then id, not input order", () => {
    const a = {
      id: "a",
      startsAt: "2026-09-18T10:00:00.000Z",
      endsAt: "2026-09-18T12:00:00.000Z",
      reason: "Morning",
    };
    const b = { id: "b", ...block, reason: "Main" };
    const c = {
      id: "c",
      startsAt: "2026-09-18T16:30:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: "Later start",
    };
    // 17:00 is covered by b (16–19) and c (16:30–20); b has earlier startsAt.
    expect(findBlockingAvailabilityBlock("2026-09-18T17:00:00.000Z", [a, b, c])?.id).toBe("b");
    expect(findBlockingAvailabilityBlock("2026-09-18T17:00:00.000Z", [c, a, b])?.id).toBe("b");
    expect(findBlockingAvailabilityBlock("2026-09-18T11:00:00.000Z", [c, b, a])?.id).toBe("a");
    expect(findBlockingAvailabilityBlock("2026-09-18T21:00:00.000Z", [a, b, c])).toBeNull();
  });

  it("treats past blocks as historical once endsAt has passed", () => {
    expect(isAvailabilityBlockCurrentOrUpcoming(block, "2026-09-18T18:59:59.000Z")).toBe(true);
    expect(isAvailabilityBlockCurrentOrUpcoming(block, "2026-09-18T19:00:00.000Z")).toBe(false);
  });
});

describe("overlapping availability precedence", () => {
  const runStart = "2026-09-18T18:30:00.000Z";
  const broad = {
    id: "broad",
    startsAt: "2026-09-18T16:00:00.000Z",
    endsAt: "2026-09-18T22:00:00.000Z",
    reason: "Broad block",
  };
  const external = {
    id: "external",
    startsAt: "2026-09-18T18:00:00.000Z",
    endsAt: "2026-09-18T21:00:00.000Z",
    reason: "External boost",
  };
  const another = {
    id: "another",
    startsAt: "2026-09-18T16:00:00.000Z",
    endsAt: "2026-09-18T20:00:00.000Z",
    reason: "Another",
  };

  it("returns the same winner for every input permutation", () => {
    // earliest startsAt → broad/another; then earliest endsAt → another
    const orders = [
      [broad, external, another],
      [another, broad, external],
      [external, another, broad],
    ];
    for (const order of orders) {
      const winner = findBlockingAvailabilityBlock(runStart, order);
      expect(winner?.id).toBe("another");
      expect(winner?.reason).toBe("Another");
    }
  });

  it("breaks same startsAt ties with earlier endsAt", () => {
    const a = {
      id: "late-end",
      startsAt: "2026-09-18T16:00:00.000Z",
      endsAt: "2026-09-18T22:00:00.000Z",
      reason: "Late end",
    };
    const b = {
      id: "early-end",
      startsAt: "2026-09-18T16:00:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: "Early end",
    };
    expect(findBlockingAvailabilityBlock(runStart, [a, b])?.id).toBe("early-end");
    expect(findBlockingAvailabilityBlock(runStart, [b, a])?.id).toBe("early-end");
  });

  it("breaks identical intervals with lexical id", () => {
    const aaa = {
      id: "aaa",
      startsAt: "2026-09-18T16:00:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: "First id",
    };
    const bbb = {
      id: "bbb",
      startsAt: "2026-09-18T16:00:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: "Second id",
    };
    expect(findBlockingAvailabilityBlock(runStart, [bbb, aaa])?.id).toBe("aaa");
    expect(findBlockingAvailabilityBlock(runStart, [aaa, bbb])?.id).toBe("aaa");
  });
});
