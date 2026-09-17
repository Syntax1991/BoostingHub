import { describe, expect, it } from "vitest";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import { mapBlizzardRaidDifficulty } from "@/lib/blizzard/raid-difficulty";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";
import {
  MANAFORGE_OMEGA_RAID_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  WOW_RAID_CATALOG,
  getCurrentLockoutRaids,
} from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { defaultRaidBossTotal, formatCompactLockoutProgress } from "@/lib/lockout-display";

const venomous = WOW_RAID_CATALOG.find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!;
const tidebound = WOW_RAID_CATALOG.find((raid) => raid.id === TIDEBOUND_GROTTO_RAID_ID)!;
const historical = WOW_RAID_CATALOG.find((raid) => raid.id === MANAFORGE_OMEGA_RAID_ID)!;
const now = new Date("2026-09-10T12:00:00.000Z");
const reset = getRegionalWeeklyReset("EU", now);
const killInReset = reset.start.getTime() + 60 * 60 * 1000;
const killBeforeReset = reset.start.getTime() - 60 * 60 * 1000;

type ModeFixture = {
  difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
  kills: Array<{ bossIndex: number; lastKillTimestampMs: number | null }>;
};

function raidPayload(
  catalog: typeof venomous,
  modes: ModeFixture[],
): BlizzardCharacterRaidEncounters["raids"][number] {
  return {
    instanceId: String(catalog.blizzardInstanceId),
    instanceName: catalog.name,
    difficulties: modes.map((mode) => ({
      difficulty: mode.difficulty,
      progressCompleted: mode.kills.filter((kill) => kill.lastKillTimestampMs != null).length,
      progressTotal: catalog.bosses.length,
      encounters: mode.kills.map((kill) => {
        const boss = catalog.bosses[kill.bossIndex]!;
        return {
          encounterId: String(boss.blizzardEncounterIds[0]),
          encounterName: boss.name,
          completedCount: kill.lastKillTimestampMs != null ? 1 : 0,
          lastKillTimestampMs: kill.lastKillTimestampMs,
        };
      }),
    })),
  };
}

function venomousEncounters(modes: ModeFixture[]): BlizzardCharacterRaidEncounters {
  return { raids: [raidPayload(venomous, modes)] };
}

function bothRaidsEncounters(input: {
  venomous: ModeFixture[];
  tidebound: ModeFixture[];
}): BlizzardCharacterRaidEncounters {
  return {
    raids: [raidPayload(venomous, input.venomous), raidPayload(tidebound, input.tidebound)],
  };
}

function raidDifficulties(result: ReturnType<typeof deriveCurrentResetLockouts>, raidId: string) {
  expect(result.status).toBe("derived");
  if (result.status !== "derived") throw new Error("expected derived");
  const raid = result.raids.find((entry) => entry.raidId === raidId);
  expect(raid).toBeDefined();
  return raid!.difficulties;
}

function progressOf(
  result: ReturnType<typeof deriveCurrentResetLockouts>,
  raidId: string,
  difficulty: "NORMAL" | "HEROIC" | "MYTHIC",
) {
  const row = raidDifficulties(result, raidId).find((entry) => entry.difficulty === difficulty);
  expect(row).toBeDefined();
  return row!;
}

describe("current raid catalog selection", () => {
  it("marks Venomous and Tidebound as current lockout raids with verified Blizzard ids", () => {
    const currentRaids = getCurrentLockoutRaids();
    expect(currentRaids.map((raid) => raid.id).sort()).toEqual(
      [TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort(),
    );

    const venomousRaid = currentRaids.find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!;
    expect(venomousRaid.blizzardInstanceId).toBe(1320);
    expect(venomousRaid.bosses).toHaveLength(8);

    const tideboundRaid = currentRaids.find((raid) => raid.id === TIDEBOUND_GROTTO_RAID_ID)!;
    expect(tideboundRaid.name).toBe("The Tidebound Grotto");
    expect(tideboundRaid.blizzardInstanceId).toBe(1317);
    expect(tideboundRaid.bosses).toHaveLength(1);
    expect(tideboundRaid.bosses[0]?.name).toBe("Nymrissa Wavecaller");
    expect(tideboundRaid.bosses[0]?.blizzardEncounterIds).toEqual([2849]);
    expect(tideboundRaid.availableForRuns).toBe(false);

    expect(historical.currentForLockouts).toBe(false);
    expect(historical.blizzardInstanceId).toBe(1302);
    expect(historical.bosses).toHaveLength(8);
  });

  it("requires an explicit raid id for catalog boss totals", () => {
    expect(defaultRaidBossTotal(VENOMOUS_ABYSS_RAID_ID)).toBe(8);
    expect(defaultRaidBossTotal(TIDEBOUND_GROTTO_RAID_ID)).toBe(1);
    expect(defaultRaidBossTotal(MANAFORGE_OMEGA_RAID_ID)).toBe(8);
    expect(defaultRaidBossTotal("00000000-0000-4000-8000-000000000000")).toBe(0);
  });

  it("does not treat Manaforge as a current lockout raid", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: {
        raids: [
          {
            instanceId: String(historical.blizzardInstanceId),
            instanceName: historical.name,
            difficulties: [
              {
                difficulty: "NORMAL",
                progressCompleted: 0,
                progressTotal: 8,
                encounters: historical.bosses.map((boss) => ({
                  encounterId: String(boss.blizzardEncounterIds[0]),
                  encounterName: boss.name,
                  completedCount: 0,
                  lastKillTimestampMs: null,
                })),
              },
            ],
          },
        ],
      },
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(result.raids.map((raid) => raid.raidId)).toEqual(
      getCurrentLockoutRaids().map((raid) => raid.id),
    );
    expect(result.raids.some((raid) => raid.raidId === MANAFORGE_OMEGA_RAID_ID)).toBe(false);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
  });
});

describe("deriveCurrentResetLockouts", () => {
  it("matches encounters by journal encounter id, not display name", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: {
        raids: [
          {
            instanceId: String(venomous.blizzardInstanceId),
            instanceName: "Der Giftige Abgrund",
            difficulties: [
              {
                difficulty: "NORMAL",
                progressCompleted: 1,
                progressTotal: 8,
                encounters: [
                  {
                    encounterId: String(venomous.bosses[0]!.blizzardEncounterIds[0]),
                    encounterName: "Localized Boss Name That Does Not Match",
                    completedCount: 1,
                    lastKillTimestampMs: killInReset,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const normal = progressOf(result, VENOMOUS_ABYSS_RAID_ID, "NORMAL");
    expect(normal.bossesDefeated).toBe(1);
    expect(normal.bosses[0]?.killedThisReset).toBe(true);
  });

  it("counts only timestamps inside the current reset window", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "NORMAL",
          kills: [
            { bossIndex: 0, lastKillTimestampMs: killInReset },
            { bossIndex: 1, lastKillTimestampMs: killBeforeReset },
            { bossIndex: 2, lastKillTimestampMs: null },
          ],
        },
      ]),
    });
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "NORMAL").bossesDefeated).toBe(1);
  });

  it("keeps Normal / Heroic / Mythic independent and zero-fills missing difficulties", () => {
    const allCurrent = venomous.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const none = venomous.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: null,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        { difficulty: "NORMAL", kills: allCurrent },
        { difficulty: "HEROIC", kills: none },
      ]),
    });
    const venomousRows = raidDifficulties(result, VENOMOUS_ABYSS_RAID_ID);
    expect(venomousRows.map((row) => row.difficulty)).toEqual(["NORMAL", "HEROIC", "MYTHIC"]);
    expect(formatCompactLockoutProgress(venomousRows)).toBe("N 8/8 · HC 0/8 · M 0/8");
  });

  it("ignores unsupported modes at the difficulty mapper boundary", () => {
    expect(mapBlizzardRaidDifficulty("LFR")).toBeNull();
  });

  it("zero-fills both current raids when only a historical raid is present", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: {
        raids: [
          {
            instanceId: String(historical.blizzardInstanceId),
            instanceName: historical.name,
            difficulties: [
              {
                difficulty: "NORMAL",
                progressCompleted: 8,
                progressTotal: 8,
                encounters: historical.bosses.map((boss) => ({
                  encounterId: String(boss.blizzardEncounterIds[0]),
                  encounterName: boss.name,
                  completedCount: 1,
                  lastKillTimestampMs: killInReset,
                })),
              },
            ],
          },
        ],
      },
    });
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "HEROIC").bossesDefeated).toBe(0);
  });

  it("derives Tidebound progress and still zero-fills Venomous when Venomous is absent", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: {
        raids: [
          {
            instanceId: "1317",
            instanceName: "The Tidebound Grotto",
            difficulties: [
              {
                difficulty: "NORMAL",
                progressCompleted: 1,
                progressTotal: 1,
                encounters: [
                  {
                    encounterId: "2849",
                    encounterName: "Nymrissa Wavecaller",
                    completedCount: 1,
                    lastKillTimestampMs: killInReset,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    const tideboundRaid = result.raids.find((raid) => raid.raidId === TIDEBOUND_GROTTO_RAID_ID)!;
    expect(tideboundRaid.blizzardInstanceId).toBe(1317);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "NORMAL").bossesDefeated).toBe(1);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossesDefeated).toBe(0);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "MYTHIC").bossesDefeated).toBe(0);
  });

  it("treats verified zero kills and missing modes as 0/N for every tracked difficulty", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "HEROIC",
          kills: venomous.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: null,
          })),
        },
      ]),
    });
    const venomousRows = raidDifficulties(result, VENOMOUS_ABYSS_RAID_ID);
    expect(venomousRows).toHaveLength(3);
    expect(formatCompactLockoutProgress(venomousRows)).toBe("N 0/8 · HC 0/8 · M 0/8");
  });

  it("matches realistic fixture A: N 8/8 HC 8/8 with Mythic verified 0/8", () => {
    const allCurrent = venomous.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const mythicOld = [{ bossIndex: 0, lastKillTimestampMs: killBeforeReset }];
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        { difficulty: "NORMAL", kills: allCurrent },
        { difficulty: "HEROIC", kills: allCurrent },
        { difficulty: "MYTHIC", kills: mythicOld },
      ]),
    });
    expect(formatCompactLockoutProgress(raidDifficulties(result, VENOMOUS_ABYSS_RAID_ID))).toBe(
      "N 8/8 · HC 8/8 · M 0/8",
    );
  });

  it("zero-fills HC/Mythic when only Normal mode is present", () => {
    const allCurrent = venomous.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([{ difficulty: "NORMAL", kills: allCurrent }]),
    });
    expect(formatCompactLockoutProgress(raidDifficulties(result, VENOMOUS_ABYSS_RAID_ID))).toBe(
      "N 8/8 · HC 0/8 · M 0/8",
    );
  });

  it("derives both current raids from one payload without aggregating totals", () => {
    const venomousHcKills = venomous.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: bossIndex < 6 ? killInReset : null,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: bothRaidsEncounters({
        venomous: [{ difficulty: "HEROIC", kills: venomousHcKills }],
        tidebound: [
          {
            difficulty: "HEROIC",
            kills: [{ bossIndex: 0, lastKillTimestampMs: killInReset }],
          },
        ],
      }),
    });

    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossesDefeated).toBe(6);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "MYTHIC").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "HEROIC").bossesDefeated).toBe(1);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "MYTHIC").bossesDefeated).toBe(0);

    const compact = [
      formatCompactLockoutProgress(raidDifficulties(result, VENOMOUS_ABYSS_RAID_ID)),
      formatCompactLockoutProgress(raidDifficulties(result, TIDEBOUND_GROTTO_RAID_ID)),
    ].join(" · ");
    expect(compact).toBe("N 0/8 · HC 6/8 · M 0/8 · N 0/1 · HC 1/1 · M 0/1");
    expect(compact).not.toContain("9/9");
    expect(compact).not.toContain("7/9");
  });

  it("zero-fills Nymrissa when only Venomous is in the payload", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "HEROIC",
          kills: venomous.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: bossIndex < 3 ? killInReset : null,
          })),
        },
      ]),
    });
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossesDefeated).toBe(3);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "NORMAL").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "HEROIC").bossesDefeated).toBe(0);
    expect(progressOf(result, TIDEBOUND_GROTTO_RAID_ID, "MYTHIC").bossesDefeated).toBe(0);
  });

  it("treats old-reset Venomous kills as current-reset zero", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "HEROIC",
          kills: venomous.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: killBeforeReset,
          })),
        },
      ]),
    });
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossesDefeated).toBe(0);
    expect(progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC").bossTotal).toBe(8);
  });

  it("preserves exact current-reset 6/8 without inventing aggregate totals", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "HEROIC",
          kills: venomous.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: bossIndex < 6 ? killInReset : null,
          })),
        },
      ]),
    });
    const heroic = progressOf(result, VENOMOUS_ABYSS_RAID_ID, "HEROIC");
    expect(heroic.bossesDefeated).toBe(6);
    expect(heroic.bossTotal).toBe(8);
    expect(heroic.isComplete).toBe(false);
  });
});
