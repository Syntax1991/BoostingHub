import { describe, expect, it } from "vitest";
import { resolveMonotonicItemLevel, toStoredItemLevel } from "@/lib/character-item-level";

describe("toStoredItemLevel", () => {
  it("floors fractional equipped values for int4 storage", () => {
    expect(toStoredItemLevel(322.625)).toBe(322);
    expect(toStoredItemLevel(304.25)).toBe(304);
    expect(toStoredItemLevel(312)).toBe(312);
    expect(toStoredItemLevel(null)).toBeNull();
    expect(toStoredItemLevel(Number.NaN)).toBeNull();
  });
});

describe("resolveMonotonicItemLevel", () => {
  it("keeps the higher of stored and incoming", () => {
    expect(resolveMonotonicItemLevel(312, 272)).toBe(312);
    expect(resolveMonotonicItemLevel(272, 312)).toBe(312);
    expect(resolveMonotonicItemLevel(300, 300)).toBe(300);
  });

  it("floors fractional incoming before compare/store", () => {
    expect(resolveMonotonicItemLevel(322, 322.625)).toBe(322);
    expect(resolveMonotonicItemLevel(320, 322.625)).toBe(322);
  });

  it("falls back when one side is missing", () => {
    expect(resolveMonotonicItemLevel(312, null)).toBe(312);
    expect(resolveMonotonicItemLevel(null, 272)).toBe(272);
    expect(resolveMonotonicItemLevel(undefined, undefined)).toBeNull();
  });
});
