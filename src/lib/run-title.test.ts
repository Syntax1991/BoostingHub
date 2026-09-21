import { describe, expect, it } from "vitest";
import { buildRunTitle } from "@/lib/run-title";
import { projectRunContentDisplay } from "@/lib/run-content-presets";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

describe("buildRunTitle", () => {
  it("formats Thu 21:00 HC VIP 8/8 Titan for Venomous", () => {
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-10T19:00:00.000Z",
        difficulty: "HEROIC",
        lootType: "VIP",
        titleCoverage: "8/8",
        raidLeadName: "Titan",
      }),
    ).toBe("Thu 21:00 HC VIP 8/8 Titan");
  });

  it("formats Fri 18:45 NM Unsaved 6/8 Titan for partial Venomous", () => {
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-11T16:45:00.000Z",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        titleCoverage: "6/8",
        raidLeadName: "Titan",
      }),
    ).toBe("Fri 18:45 NM Unsaved 6/8 Titan");
  });

  it("formats Bundle titles with summed coverage (9/9), not S2B", () => {
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-12T21:00:00.000Z",
        difficulty: "MYTHIC",
        lootType: "VIP",
        titleCoverage: "9/9",
        raidLeadName: "Thorne",
      }),
    ).toBe("Sat 23:00 MY VIP 9/9 Thorne");

    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-13T18:00:00.000Z",
        difficulty: "HEROIC",
        lootType: "SAVED",
        titleCoverage: "7/9",
        raidLeadName: "Aelira",
      }),
    ).toBe("Sun 20:00 HC Saved 7/9 Aelira");
  });

  it("never renders MY Saved — MYTHIC always pairs with UNSAVED or VIP", () => {
    const title = buildRunTitle({
      scheduledStartAt: "2026-09-12T21:00:00.000Z",
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      titleCoverage: "8/8",
      raidLeadName: "Thorne",
    });
    expect(title).not.toContain("MY Saved");
  });

  it("is deterministic for the same input", () => {
    const input = {
      scheduledStartAt: "2026-09-10T19:00:00.000Z",
      difficulty: "HEROIC" as const,
      lootType: "VIP" as const,
      titleCoverage: "8/8",
      raidLeadName: "Titan",
    };
    expect(buildRunTitle(input)).toBe(buildRunTitle(input));
  });
});

describe("projectRunContentDisplay coverage tokens", () => {
  it("projects Venomous as-is and Bundle as summed Tide+VA coverage", () => {
    const venomous = projectRunContentDisplay([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 1,
        plannedBossCount: 8,
        totalBossCount: 8,
      },
    ]);
    expect(venomous.titleCoverage).toBe("8/8");
    expect(venomous.channelCoverage).toBe("8of8");

    const bundle = projectRunContentDisplay([
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "The Tidebound Grotto",
        sortOrder: 1,
        plannedBossCount: 1,
        totalBossCount: 1,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 2,
        plannedBossCount: 6,
        totalBossCount: 8,
      },
    ]);
    expect(bundle.titleCoverage).toBe("7/9");
    expect(bundle.channelCoverage).toBe("7of9");
    expect(bundle.summary).toBe("Tide 1/1 · The Venomous Abyss 6/8");
    expect(bundle.titleCoverage).not.toMatch(/S2B|s2b/);
    expect(bundle.channelCoverage).not.toMatch(/s2b/);
  });
});
