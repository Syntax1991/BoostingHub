import { describe, expect, it } from "vitest";
import { mapPlayableClassId, requirePlayableClassId } from "@/lib/blizzard/playable-class";
import type { WowClass } from "@/models/enums";

const EXPECTED: ReadonlyArray<readonly [number, WowClass]> = [
  [1, "WARRIOR"],
  [2, "PALADIN"],
  [3, "HUNTER"],
  [4, "ROGUE"],
  [5, "PRIEST"],
  [6, "DEATH_KNIGHT"],
  [7, "SHAMAN"],
  [8, "MAGE"],
  [9, "WARLOCK"],
  [10, "MONK"],
  [11, "DRUID"],
  [12, "DEMON_HUNTER"],
  [13, "EVOKER"],
];

describe("mapPlayableClassId", () => {
  it("maps known Blizzard playable_class ids 1–13", () => {
    for (const [id, wowClass] of EXPECTED) {
      expect(mapPlayableClassId(id)).toBe(wowClass);
      expect(requirePlayableClassId(id)).toBe(wowClass);
    }
  });

  it("returns null for unknown ids", () => {
    expect(mapPlayableClassId(0)).toBeNull();
    expect(mapPlayableClassId(14)).toBeNull();
    expect(mapPlayableClassId(-1)).toBeNull();
  });

  it("throws from requirePlayableClassId for unknown ids", () => {
    expect(() => requirePlayableClassId(99)).toThrow(/Unknown Blizzard playable_class id: 99/);
  });
});
