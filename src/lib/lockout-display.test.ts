import { describe, expect, it } from "vitest";
import {
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
  { id: TIDEBOUND_GROTTO_RAID_ID, name: "Tide" },
] as const;

describe("formatCompactLockoutProgress", () => {
  it("shows ? for missing difficulties once any row is verified", () => {
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

  it("does not invent 0/N for empty input", () => {
    expect(formatCompactLockoutProgress([])).toBeNull();
  });
});

describe("formatCompactMultiRaidLockoutProgress", () => {
  it("CASE 1: only Tide rows → Venomous Unknown + Tide progress", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          raidName: "The Tidebound Grotto",
          difficulty: "NORMAL",
          bossesDefeated: 0,
          bossTotal: 1,
        },
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 0,
          bossTotal: 1,
        },
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "MYTHIC",
          bossesDefeated: 0,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(text).toBe(
      "The Venomous Abyss: Unknown · Tide: N 0/1 · HC 0/1 · M 0/1",
    );
    expect(text).not.toMatch(/0\/8/);
    expect(text).not.toMatch(/9\/9/);
  });

  it("CASE 2: only Venomous rows → Tide Unknown", () => {
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
    expect(text).toBe("The Venomous Abyss: N ? · HC 3/8 · M ? · Tide: Unknown");
  });

  it("CASE 3: both raids have verified rows", () => {
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
    expect(text).toContain("The Venomous Abyss:");
    expect(text).toContain("Tide:");
    expect(text).not.toContain("Unknown");
    expect(text).not.toMatch(/9\/9|4\/9/);
  });

  it("CASE 4: no current rows → both Unknown, not a collapsed generic Unknown", () => {
    const text = formatCompactMultiRaidLockoutProgress([], CURRENT);
    expect(text).toBe("The Venomous Abyss: Unknown · Tide: Unknown");
    expect(text).not.toBe("Unknown");
  });

  it("CASE 5: partial difficulty on Venomous shows M ?", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
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
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 0,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(text).toContain("The Venomous Abyss: N 0/8 · HC 3/8 · M ?");
    expect(text).not.toContain("M 0/8");
  });

  it("CASE 6: only old-reset rows are already filtered out — empty current rows stay Unknown", () => {
    // Service filters by current reset before calling the helper; leftover rows
    // without a matching currentRaid id must not invent progress.
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
    expect(text).toBe("The Venomous Abyss: Unknown · Tide: Unknown");
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
    const tideAt = text.indexOf("Tide:");
    expect(venomousAt).toBeGreaterThanOrEqual(0);
    expect(tideAt).toBeGreaterThan(venomousAt);
  });
});

describe("projectCurrentRaidLockoutSlots", () => {
  it("marks missing current raids UNKNOWN without inventing difficulty rows", () => {
    const slots = projectCurrentRaidLockoutSlots(
      [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 0,
          bossTotal: 1,
        },
      ],
      CURRENT,
    );
    expect(slots).toEqual([
      { raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", status: "UNKNOWN" },
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "Tide",
        status: "VERIFIED",
        rows: [
          {
            raidId: TIDEBOUND_GROTTO_RAID_ID,
            difficulty: "HEROIC",
            bossesDefeated: 0,
            bossTotal: 1,
          },
        ],
      },
    ]);
  });
});
