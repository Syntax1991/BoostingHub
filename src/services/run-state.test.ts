import { describe, expect, it } from "vitest";
import { isDomainError } from "@/lib/errors";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import {
  assertValidPlannedBossCount,
  assertValidRunLootType,
  isLootTypeAllowedForDifficulty,
} from "@/services/run-state";

// The authoritative compatibility matrix: every difficulty allows every loot
// type except MYTHIC+SAVED. Table-driven so adding a new difficulty or loot
// type surfaces here as an obviously-incomplete matrix rather than silently
// passing.
const EXPECTED: Record<RaidDifficulty, Record<RunLootType, boolean>> = {
  NORMAL: { SAVED: true, UNSAVED: true, VIP: true },
  HEROIC: { SAVED: true, UNSAVED: true, VIP: true },
  MYTHIC: { SAVED: false, UNSAVED: true, VIP: true },
};

describe("isLootTypeAllowedForDifficulty", () => {
  for (const difficulty of RAID_DIFFICULTIES) {
    for (const lootType of RUN_LOOT_TYPES) {
      const expected = EXPECTED[difficulty][lootType];
      it(`${difficulty} + ${lootType} -> ${expected ? "allowed" : "rejected"}`, () => {
        expect(isLootTypeAllowedForDifficulty(difficulty, lootType)).toBe(expected);
      });
    }
  }
});

describe("assertValidRunLootType", () => {
  it("throws RUN_LOOT_TYPE_INVALID for MYTHIC + SAVED", () => {
    try {
      assertValidRunLootType("MYTHIC", "SAVED");
      throw new Error("expected assertValidRunLootType to throw");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("RUN_LOOT_TYPE_INVALID");
    }
  });

  it("does not throw for every other combination", () => {
    for (const difficulty of RAID_DIFFICULTIES) {
      for (const lootType of RUN_LOOT_TYPES) {
        if (difficulty === "MYTHIC" && lootType === "SAVED") continue;
        expect(() => assertValidRunLootType(difficulty, lootType)).not.toThrow();
      }
    }
  });
});

describe("assertValidPlannedBossCount", () => {
  it("accepts values within [1, total]", () => {
    expect(() => assertValidPlannedBossCount(1, 9)).not.toThrow();
    expect(() => assertValidPlannedBossCount(9, 9)).not.toThrow();
    expect(() => assertValidPlannedBossCount(5, 9)).not.toThrow();
  });

  it("rejects 0, negative, non-integer, and values above the total", () => {
    for (const invalid of [0, -1, 1.5, 10]) {
      try {
        assertValidPlannedBossCount(invalid, 9);
        throw new Error(`expected ${invalid} to be rejected`);
      } catch (error) {
        expect(isDomainError(error) && error.code).toBe("RUN_BOSS_COUNT_INVALID");
      }
    }
  });
});
