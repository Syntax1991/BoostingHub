import { describe, expect, it } from "vitest";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import { mapBlizzardRaidDifficulty } from "@/lib/blizzard/raid-difficulty";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";
import {
  MANAFORGE_OMEGA_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  WOW_RAID_CATALOG,
  getCurrentLockoutRaid,
} from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { formatCompactLockoutProgress } from "@/lib/lockout-display";

const current = getCurrentLockoutRaid()!;
const historical = WOW_RAID_CATALOG.find((raid) => raid.id === MANAFORGE_OMEGA_RAID_ID)!;
const now = new Date("2026-09-10T12:00:00.000Z");
const reset = getRegionalWeeklyReset("EU", now);
const killInReset = reset.start.getTime() + 60 * 60 * 1000;
const killBeforeReset = reset.start.getTime() - 60 * 60 * 1000;

function venomousEncounters(
  modes: Array<{
    difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
    kills: Array<{ bossIndex: number; lastKillTimestampMs: number | null }>;
  }>,
): BlizzardCharacterRaidEncounters {
  return {
    raids: [
      {
        instanceId: String(current.blizzardInstanceId),
        instanceName: current.name,
        difficulties: modes.map((mode) => ({
          difficulty: mode.difficulty,
          progressCompleted: mode.kills.filter((kill) => kill.lastKillTimestampMs != null).length,
          progressTotal: current.bosses.length,
          encounters: mode.kills.map((kill) => {
            const boss = current.bosses[kill.bossIndex]!;
            return {
              encounterId: String(boss.blizzardEncounterIds[0]),
              encounterName: boss.name,
              completedCount: kill.lastKillTimestampMs != null ? 1 : 0,
              lastKillTimestampMs: kill.lastKillTimestampMs,
            };
          }),
        })),
      },
    ],
  };
}

describe("current raid catalog selection", () => {
  it("marks The Venomous Abyss as the only current lockout raid", () => {
    expect(current.id).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(current.blizzardInstanceId).toBe(1320);
    expect(current.bosses).toHaveLength(8);
    expect(historical.currentForLockouts).toBe(false);
    expect(historical.blizzardInstanceId).toBe(1302);
    expect(historical.bosses).toHaveLength(8);
  });

  it("does not select Manaforge solely because it also has 8 bosses", () => {
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
    expect(result.status).toBe("unknown");
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
            instanceId: String(current.blizzardInstanceId),
            instanceName: "Der Giftige Abgrund",
            difficulties: [
              {
                difficulty: "NORMAL",
                progressCompleted: 1,
                progressTotal: 8,
                encounters: [
                  {
                    encounterId: String(current.bosses[0]!.blizzardEncounterIds[0]),
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
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(result.difficulties[0]?.bossesDefeated).toBe(1);
    expect(result.difficulties[0]?.bosses[0]?.killedThisReset).toBe(true);
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
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    const normal = result.difficulties.find((row) => row.difficulty === "NORMAL")!;
    expect(normal.bossesDefeated).toBe(1);
  });

  it("keeps Normal / Heroic / Mythic independent and omits missing difficulties", () => {
    const allCurrent = current.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const none = current.bosses.map((_, bossIndex) => ({
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
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(result.difficulties.map((row) => row.difficulty).sort()).toEqual(["HEROIC", "NORMAL"]);
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC 0/8 · M ?");
  });

  it("ignores unsupported modes at the difficulty mapper boundary", () => {
    expect(mapBlizzardRaidDifficulty("LFR")).toBeNull();
  });

  it("returns unknown when current raid instance is missing even if historical 8-boss raid exists", () => {
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
    expect(result.status).toBe("unknown");
  });

  it("treats verified zero kills as 0/N clear for that difficulty only", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([
        {
          difficulty: "HEROIC",
          kills: current.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: null,
          })),
        },
      ]),
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(result.difficulties).toHaveLength(1);
    expect(result.difficulties[0]?.bossesDefeated).toBe(0);
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N ? · HC 0/8 · M ?");
  });

  it("matches realistic fixture A: N 8/8 HC 8/8 with Mythic verified 0/8", () => {
    const allCurrent = current.bosses.map((_, bossIndex) => ({
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
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC 8/8 · M 0/8");
  });

  it("matches realistic fixture B: N 8/8 with HC/Mythic unknown when modes absent", () => {
    const allCurrent = current.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: venomousEncounters([{ difficulty: "NORMAL", kills: allCurrent }]),
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC ? · M ?");
  });
});
