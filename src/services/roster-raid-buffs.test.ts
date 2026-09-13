import { describe, expect, it } from "vitest";
import type { LootbuddyMode, ParticipationType, WowClass } from "@/models/enums";
import {
  evaluateRaidBuffCoverage,
  RAID_BUFF_DEFINITIONS,
  resolveBuffContributorClass,
  type RaidBuffParticipant,
} from "@/services/roster-raid-buffs";

function participant(overrides: Partial<RaidBuffParticipant> & { signupId: string; wowClass: WowClass | null }): RaidBuffParticipant {
  return {
    userName: "Syntax",
    participationType: "BOOSTER",
    lootbuddyMode: null,
    characterName: "Synlight",
    ...overrides,
  };
}

function coverageById(participants: RaidBuffParticipant[]) {
  const result = evaluateRaidBuffCoverage(participants);
  return Object.fromEntries(result.buffs.map((item) => [item.id, item]));
}

describe("resolveBuffContributorClass", () => {
  it("uses Character class for BOOSTER", () => {
    expect(
      resolveBuffContributorClass({
        participationType: "BOOSTER",
        lootbuddyMode: null,
        lootbuddyClass: "MAGE",
        characterWowClass: "SHAMAN",
      }),
    ).toBe("SHAMAN");
  });

  it("uses lootbuddyClass for PLAYING Lootbuddy", () => {
    expect(
      resolveBuffContributorClass({
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        lootbuddyClass: "MAGE",
        characterWowClass: null,
      }),
    ).toBe("MAGE");
  });

  it("falls back to character class for legacy PLAYING Lootbuddy", () => {
    expect(
      resolveBuffContributorClass({
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        lootbuddyClass: null,
        characterWowClass: "MAGE",
      }),
    ).toBe("MAGE");
  });

  it("returns null for LOOT_ONLY even when class is known", () => {
    expect(
      resolveBuffContributorClass({
        participationType: "LOOTBUDDY",
        lootbuddyMode: "LOOT_ONLY",
        lootbuddyClass: "PRIEST",
        characterWowClass: "PRIEST",
      }),
    ).toBeNull();
  });

  it("returns null when class cannot be resolved", () => {
    expect(
      resolveBuffContributorClass({
        participationType: "BOOSTER",
        lootbuddyMode: null,
        lootbuddyClass: null,
        characterWowClass: null,
      }),
    ).toBeNull();
  });
});

describe("evaluateRaidBuffCoverage", () => {
  it("A: empty roster covers nothing", () => {
    const result = evaluateRaidBuffCoverage([]);
    expect(result.totalCount).toBe(RAID_BUFF_DEFINITIONS.length);
    expect(result.coveredCount).toBe(0);
    expect(result.missingCount).toBe(RAID_BUFF_DEFINITIONS.length);
    expect(result.buffs.every((item) => !item.covered)).toBe(true);
  });

  it("B: one Mage Booster covers Arcane Intellect only", () => {
    const byId = coverageById([participant({ signupId: "s1", wowClass: "MAGE" })]);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(byId.POWER_WORD_FORTITUDE?.covered).toBe(false);
    expect(byId.ARCANE_INTELLECT?.providers).toHaveLength(1);
    expect(byId.ARCANE_INTELLECT?.providers[0]?.signupId).toBe("s1");
  });

  it("C: caller responsibility — unselected Mage is simply omitted from the input", () => {
    // Domain evaluator only sees selected participants. An unselected Mage never appears here.
    const result = evaluateRaidBuffCoverage([]);
    expect(result.buffs.find((item) => item.id === "ARCANE_INTELLECT")?.covered).toBe(false);
  });

  it("D: Mage LOOT_ONLY does not cover (wowClass already resolved to null by caller)", () => {
    const byId = coverageById([
      participant({
        signupId: "lb1",
        wowClass: null,
        participationType: "LOOTBUDDY",
        lootbuddyMode: "LOOT_ONLY",
        characterName: null,
      }),
    ]);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(false);
  });

  it("E: Mage PLAYING Lootbuddy covers Arcane Intellect", () => {
    const byId = coverageById([
      participant({
        signupId: "lb1",
        wowClass: "MAGE",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: null,
      }),
    ]);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(byId.ARCANE_INTELLECT?.providers[0]?.participationType).toBe("LOOTBUDDY");
  });

  it("F: legacy Character-backed PLAYING Mage Lootbuddy covers via resolved class", () => {
    const byId = coverageById([
      participant({
        signupId: "lb-legacy",
        wowClass: "MAGE",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: "Oldmage",
      }),
    ]);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
  });

  it("G: duplicate Mages still count as one covered buff, but keep all providers", () => {
    const byId = coverageById([
      participant({ signupId: "s1", wowClass: "MAGE", characterName: "A" }),
      participant({ signupId: "s2", wowClass: "MAGE", characterName: "B" }),
      participant({
        signupId: "lb1",
        wowClass: "MAGE",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: null,
      }),
    ]);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(byId.ARCANE_INTELLECT?.providers).toHaveLength(3);
    expect(evaluateRaidBuffCoverage([
      participant({ signupId: "s1", wowClass: "MAGE" }),
      participant({ signupId: "s2", wowClass: "MAGE" }),
      participant({ signupId: "lb1", wowClass: "MAGE", participationType: "LOOTBUDDY", lootbuddyMode: "PLAYING", characterName: null }),
    ]).coveredCount).toBe(1);
  });

  it("H/I: same User Booster + PLAYING Lootbuddies contribute distinct classes without userId collapse", () => {
    const result = evaluateRaidBuffCoverage([
      participant({ signupId: "boost", wowClass: "SHAMAN", characterName: "Synlight" }),
      participant({
        signupId: "lb-priest",
        wowClass: "PRIEST",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: null,
      }),
      participant({
        signupId: "lb-mage",
        wowClass: "MAGE",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: null,
      }),
    ]);
    const byId = Object.fromEntries(result.buffs.map((item) => [item.id, item]));
    expect(byId.SKYFURY?.covered).toBe(true);
    expect(byId.POWER_WORD_FORTITUDE?.covered).toBe(true);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(result.coveredCount).toBe(3);
    expect(new Set(result.buffs.flatMap((item) => item.providers.map((p) => p.signupId))).size).toBe(3);
  });

  it("J: LOOT_ONLY Priest does not cover Fortitude; PLAYING Warrior covers Battle Shout", () => {
    const byId = coverageById([
      participant({
        signupId: "lb-priest",
        wowClass: null,
        participationType: "LOOTBUDDY",
        lootbuddyMode: "LOOT_ONLY",
        characterName: null,
      }),
      participant({
        signupId: "lb-warrior",
        wowClass: "WARRIOR",
        participationType: "LOOTBUDDY",
        lootbuddyMode: "PLAYING",
        characterName: null,
      }),
    ]);
    expect(byId.POWER_WORD_FORTITUDE?.covered).toBe(false);
    expect(byId.BATTLE_SHOUT?.covered).toBe(true);
  });

  it("K: null/unknown class never crashes and never falsely covers", () => {
    const result = evaluateRaidBuffCoverage([
      participant({ signupId: "bad", wowClass: null, characterName: null }),
    ]);
    expect(result.coveredCount).toBe(0);
    expect(result.buffs).toHaveLength(RAID_BUFF_DEFINITIONS.length);
  });

  it("full class matrix: each provider class covers exactly its mapped buff", () => {
    const matrix: Array<{ wowClass: WowClass; buffId: string }> = [
      { wowClass: "MAGE", buffId: "ARCANE_INTELLECT" },
      { wowClass: "PRIEST", buffId: "POWER_WORD_FORTITUDE" },
      { wowClass: "WARRIOR", buffId: "BATTLE_SHOUT" },
      { wowClass: "DRUID", buffId: "MARK_OF_THE_WILD" },
      { wowClass: "SHAMAN", buffId: "SKYFURY" },
      { wowClass: "PALADIN", buffId: "DEVOTION_AURA" },
      { wowClass: "EVOKER", buffId: "BLESSING_OF_THE_BRONZE" },
      { wowClass: "DEMON_HUNTER", buffId: "CHAOS_BRAND" },
      { wowClass: "MONK", buffId: "MYSTIC_TOUCH" },
    ];

    for (const { wowClass, buffId } of matrix) {
      const byId = coverageById([participant({ signupId: `s-${wowClass}`, wowClass })]);
      expect(byId[buffId]?.covered, `${wowClass} → ${buffId}`).toBe(true);
      for (const other of matrix) {
        if (other.buffId === buffId) continue;
        expect(byId[other.buffId]?.covered, `${wowClass} must not cover ${other.buffId}`).toBe(false);
      }
    }
  });

  it("classes without a tracked buff cover nothing", () => {
    for (const wowClass of ["HUNTER", "ROGUE", "WARLOCK", "DEATH_KNIGHT"] as WowClass[]) {
      expect(evaluateRaidBuffCoverage([participant({ signupId: wowClass, wowClass })]).coveredCount).toBe(0);
    }
  });

  it("PR #27 regression: Shaman Booster + Mage PLAYING + Priest LOOT_ONLY", () => {
    const shaman = resolveBuffContributorClass({
      participationType: "BOOSTER",
      lootbuddyMode: null,
      lootbuddyClass: null,
      characterWowClass: "SHAMAN",
    });
    const magePlaying = resolveBuffContributorClass({
      participationType: "LOOTBUDDY",
      lootbuddyMode: "PLAYING",
      lootbuddyClass: "MAGE",
      characterWowClass: null,
    });
    const priestLootOnly = resolveBuffContributorClass({
      participationType: "LOOTBUDDY",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyClass: "PRIEST",
      characterWowClass: null,
    });

    const byId = coverageById([
      participant({ signupId: "b", wowClass: shaman }),
      participant({
        signupId: "m",
        wowClass: magePlaying,
        participationType: "LOOTBUDDY" as ParticipationType,
        lootbuddyMode: "PLAYING" as LootbuddyMode,
        characterName: null,
      }),
      participant({
        signupId: "p",
        wowClass: priestLootOnly,
        participationType: "LOOTBUDDY",
        lootbuddyMode: "LOOT_ONLY",
        characterName: null,
      }),
    ]);

    expect(byId.SKYFURY?.covered).toBe(true);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(byId.POWER_WORD_FORTITUDE?.covered).toBe(false);
  });
});
