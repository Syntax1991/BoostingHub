import { describe, expect, it } from "vitest";
import { WOW_CLASSES } from "@/models/enums";
import type { CommunityStatsPool } from "@/repositories/community-stats.repository";
import { aggregateCommunityStats } from "@/services/community-stats.service";

function pool(partial: Partial<CommunityStatsPool> & { boosterIds: string[] }): CommunityStatsPool {
  return {
    boosterIds: partial.boosterIds,
    characters: partial.characters ?? [],
  };
}

describe("aggregateCommunityStats", () => {
  it("empty pool returns zeros with every role and class key present", () => {
    const stats = aggregateCommunityStats(pool({ boosterIds: [] }));
    expect(stats.activeBoosters).toBe(0);
    expect(stats.activeCharacters).toBe(0);
    expect(stats.roles).toEqual({
      TANK: { characters: 0, boosters: 0 },
      HEALER: { characters: 0, boosters: 0 },
      MELEE_DPS: { characters: 0, boosters: 0 },
      RANGED_DPS: { characters: 0, boosters: 0 },
    });
    expect(Object.keys(stats.classes).sort()).toEqual([...WOW_CLASSES].sort());
    for (const wowClass of WOW_CLASSES) {
      expect(stats.classes[wowClass]).toBe(0);
    }
    expect(stats.multiRole).toEqual({ characters: 0, boosters: 0 });
  });

  it("counts activeBoosters from boosterIds even when they have no Characters", () => {
    const stats = aggregateCommunityStats(pool({ boosterIds: ["u1", "u2"] }));
    expect(stats.activeBoosters).toBe(2);
    expect(stats.activeCharacters).toBe(0);
  });

  it("primary HEALER only → HEALER character and booster", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            playableSpecs: [],
          },
        ],
      }),
    );
    expect(stats.activeCharacters).toBe(1);
    expect(stats.roles.HEALER).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.TANK).toEqual({ characters: 0, boosters: 0 });
    expect(stats.roles.MELEE_DPS).toEqual({ characters: 0, boosters: 0 });
    expect(stats.roles.RANGED_DPS).toEqual({ characters: 0, boosters: 0 });
    expect(stats.classes.SHAMAN).toBe(1);
    expect(stats.multiRole).toEqual({ characters: 0, boosters: 0 });
  });

  it("offspec adds a second concrete role (Restoration + Elemental)", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            playableSpecs: ["Elemental"],
          },
        ],
      }),
    );
    expect(stats.activeCharacters).toBe(1);
    expect(stats.roles.HEALER).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.RANGED_DPS).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.MELEE_DPS).toEqual({ characters: 0, boosters: 0 });
    expect(stats.multiRole).toEqual({ characters: 1, boosters: 1 });
  });

  it("multiple specs mapping to the same concrete role count once and are not multi-role", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "WARRIOR",
            specialization: "Arms",
            playableSpecs: ["Fury"],
          },
        ],
      }),
    );
    expect(stats.roles.MELEE_DPS).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.TANK).toEqual({ characters: 0, boosters: 0 });
    expect(stats.multiRole).toEqual({ characters: 0, boosters: 0 });
  });

  it("one User with five Tank Characters → characters=5 boosters=1", () => {
    const characters = [1, 2, 3, 4, 5].map((n) => ({
      id: `tank-${n}`,
      userId: "u1",
      wowClass: "WARRIOR" as const,
      specialization: "Protection",
      playableSpecs: [] as string[],
    }));
    const stats = aggregateCommunityStats(pool({ boosterIds: ["u1"], characters }));
    expect(stats.roles.TANK).toEqual({ characters: 5, boosters: 1 });
    expect(stats.activeCharacters).toBe(5);
    expect(stats.activeBoosters).toBe(1);
  });

  it("two Users with Tank Characters → booster dedupe is per User", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1", "u2"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "WARRIOR",
            specialization: "Protection",
            playableSpecs: [],
          },
          {
            id: "c2",
            userId: "u1",
            wowClass: "PALADIN",
            specialization: "Protection",
            playableSpecs: [],
          },
          {
            id: "c3",
            userId: "u2",
            wowClass: "DEATH_KNIGHT",
            specialization: "Blood",
            playableSpecs: [],
          },
        ],
      }),
    );
    expect(stats.roles.TANK).toEqual({ characters: 3, boosters: 2 });
  });

  it("User with multiple multi-role Characters → multiRole booster counted once", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            playableSpecs: ["Elemental"],
          },
          {
            id: "c2",
            userId: "u1",
            wowClass: "DRUID",
            specialization: "Restoration",
            playableSpecs: ["Guardian"],
          },
        ],
      }),
    );
    expect(stats.multiRole).toEqual({ characters: 2, boosters: 1 });
  });

  it("invalid/unknown playable spec is ignored by availableRoles (no invented validation)", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            playableSpecs: ["NotARealSpec", "Arcane"],
          },
        ],
      }),
    );
    expect(stats.roles.HEALER).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.RANGED_DPS).toEqual({ characters: 0, boosters: 0 });
    expect(stats.multiRole).toEqual({ characters: 0, boosters: 0 });
  });

  it("builds class distribution across the active Character pool", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1", "u2"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "MAGE",
            specialization: "Arcane",
            playableSpecs: [],
          },
          {
            id: "c2",
            userId: "u1",
            wowClass: "MAGE",
            specialization: "Fire",
            playableSpecs: [],
          },
          {
            id: "c3",
            userId: "u2",
            wowClass: "HUNTER",
            specialization: "Beast Mastery",
            playableSpecs: [],
          },
        ],
      }),
    );
    expect(stats.classes.MAGE).toBe(2);
    expect(stats.classes.HUNTER).toBe(1);
    expect(stats.classes.WARRIOR).toBe(0);
  });

  it("does not use generic DPS and never invents a DPS role bucket", () => {
    const stats = aggregateCommunityStats(
      pool({
        boosterIds: ["u1"],
        characters: [
          {
            id: "c1",
            userId: "u1",
            wowClass: "MAGE",
            specialization: "Frost",
            playableSpecs: [],
          },
        ],
      }),
    );
    expect(Object.keys(stats.roles)).toEqual(["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS"]);
    expect(stats.roles.RANGED_DPS).toEqual({ characters: 1, boosters: 1 });
    expect(stats.roles.MELEE_DPS).toEqual({ characters: 0, boosters: 0 });
  });
});
