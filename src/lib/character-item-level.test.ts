import { describe, expect, it } from "vitest";
import { resolveMonotonicItemLevel } from "@/lib/character-item-level";

describe("resolveMonotonicItemLevel", () => {
  it("keeps the higher of stored and incoming", () => {
    expect(resolveMonotonicItemLevel(312, 272)).toBe(312);
    expect(resolveMonotonicItemLevel(272, 312)).toBe(312);
    expect(resolveMonotonicItemLevel(300, 300)).toBe(300);
  });

  it("falls back when one side is missing", () => {
    expect(resolveMonotonicItemLevel(312, null)).toBe(312);
    expect(resolveMonotonicItemLevel(null, 272)).toBe(272);
    expect(resolveMonotonicItemLevel(undefined, undefined)).toBeNull();
  });
});
