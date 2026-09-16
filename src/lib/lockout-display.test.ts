import { describe, expect, it } from "vitest";
import {
  defaultRaidBossTotal,
  formatCompactLockoutProgress,
  formatCompactMultiRaidLockoutProgress,
  projectCurrentRaidLockoutSlots,
} from "@/lib/lockout-display";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

const CURRENT = [
  { id: VENOMOUS_ABYSS_RAID_ID, name: "The Venomous Abyss" },
  { id: TIDEBOUND_GROTTO_RAID_ID, name: "Nymrissa" },
] as const;

const ZERO_BOTH =
  "The Venomous Abyss: N 0/8 · HC 0/8 · M 0/8 · Nymrissa: N 0/1 · HC 0/1 · M 0/1";

describe("catalog boss totals", () => {
  it("uses catalog authority for Venomous and Nymrissa", () => {
    expect(defaultRaidBossTotal(VENOMOUS_ABYSS_RAID_ID)).toBe(8);
    expect(defaultRaidBossTotal(TIDEBOUND_GROTTO_RAID_ID)).toBe(1);
  });
});

describe("formatCompactLockoutProgress", () => {
  it("still shows ? for incomplete Blizzard derivation inputs", () => {
    const text = formatCompactLockoutProgress([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "NORMAL",
        bossesDefeated: 0,
        bossTotal: 8,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "HEROIC",
        bossesDefeated: 3,
        bossTotal: 8,
      },
    ]);
    expect(text).toBe("N 0/8 · HC 3/8 · M ?");
  });

  it("does not invent rows for empty input", () => {
    expect(formatCompactLockoutProgress([])).toBeNull();
  });
});

describe("formatCompactMultiRaidLockoutProgress", () => {
  it("CASE 1: no rows → zero progress for every current raid/difficulty", () => {
    expect(formatCompactMultiRaidLockoutProgress([], CURRENT)).toBe(ZERO_BOTH);
    expect(formatCompactMultiRaidLockoutProgress([], CURRENT)).not.toContain("Unknown");
    expect(formatCompactMultiRaidLockoutProgress([], CURRENT)).not.toContain("?");
    expect(formatCompactMultiRaidLockoutProgress([], CURRENT)).not.toMatch(/9\/9/);
  });

  it("CASE 2: only Nymrissa HC 1/1 → Venomous zeros + Nymrissa partial zeros", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(text).toBe(
      "The Venomous Abyss: N 0/8 · HC 0/8 · M 0/8 · Nymrissa: N 0/1 · HC 1/1 · M 0/1",
    );
    expect(text).not.toContain("?");
    expect(text).not.toContain("Unknown");
  });

  it("CASE 3: only Venomous HC 3/8 → Nymrissa zeros", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 3,
          bossTotal: 8,
        },
      ],
      CURRENT,
    );
    expect(text).toBe(
      "The Venomous Abyss: N 0/8 · HC 3/8 · M 0/8 · Nymrissa: N 0/1 · HC 0/1 · M 0/1",
    );
  });

  it("CASE 4: both raids have rows — missing difficulties filled with zero", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "NORMAL",
          bossesDefeated: 8,
          bossTotal: 8,
        },
      ],
      CURRENT,
    );
    expect(text).toBe(
      "The Venomous Abyss: N 8/8 · HC 0/8 · M 0/8 · Nymrissa: N 0/1 · HC 1/1 · M 0/1",
    );
    expect(text).not.toMatch(/9\/9|4\/9/);
  });

  it("CASE 5: complete rows remain exact", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "NORMAL",
          bossesDefeated: 8,
          bossTotal: 8,
        },
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(text).toContain("The Venomous Abyss: N 8/8 · HC 0/8 · M 0/8");
    expect(text).toContain("Nymrissa: N 0/1 · HC 1/1 · M 0/1");
  });

  it("CASE 6: non-current/old raid rows ignored → current display all zero", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: "historical-raid-id",
          raidName: "Manaforge Omega",
          difficulty: "HEROIC",
          bossesDefeated: 8,
          bossTotal: 8,
        },
      ],
      CURRENT,
    );
    expect(text).toBe(ZERO_BOTH);
  });

  it("CASE 7: output order follows currentLockoutRaids, not input row order", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 2,
          bossTotal: 8,
        },
      ],
      CURRENT,
    );
    const venomousAt = text.indexOf("The Venomous Abyss:");
    const nymrissaAt = text.indexOf("Nymrissa:");
    expect(venomousAt).toBeGreaterThanOrEqual(0);
    expect(nymrissaAt).toBeGreaterThan(venomousAt);
  });

  it("CASE 8: never aggregates to 9/9", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 8,
          bossTotal: 8,
        },
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(text).not.toMatch(/9\/9|4\/9/);
  });
});

describe("projectCurrentRaidLockoutSlots", () => {
  it("zero-fills missing difficulties without inventing persisted rows", () => {
    const slots = projectCurrentRaidLockoutSlots(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 1,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]?.raidName).toBe("The Venomous Abyss");
    expect(slots[0]?.rows).toEqual([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        difficulty: "NORMAL",
        bossesDefeated: 0,
        bossTotal: 8,
        isComplete: false,
        verified: false,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        difficulty: "HEROIC",
        bossesDefeated: 0,
        bossTotal: 8,
        isComplete: false,
        verified: false,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        difficulty: "MYTHIC",
        bossesDefeated: 0,
        bossTotal: 8,
        isComplete: false,
        verified: false,
      },
    ]);
    expect(slots[1]?.rows.map((row) => [row.difficulty, row.bossesDefeated, row.verified])).toEqual([
      ["NORMAL", 0, false],
      ["HEROIC", 1, true],
      ["MYTHIC", 0, false],
    ]);
  });
});
