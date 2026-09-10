import { describe, expect, it } from "vitest";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { formatCompactLockoutProgress } from "@/lib/lockout-display";

const catalog = WOW_RAID_CATALOG[0]!;
const instanceId = String(catalog.blizzardInstanceId);
const now = new Date("2026-03-12T12:00:00.000Z");
const reset = getRegionalWeeklyReset("EU", now);
const killInReset = reset.start.getTime() + 60 * 60 * 1000;
const killBeforeReset = reset.start.getTime() - 60 * 60 * 1000;

function encountersFor(
  modes: Array<{
    difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
    kills: Array<{ bossIndex: number; lastKillTimestampMs: number | null }>;
  }>,
): BlizzardCharacterRaidEncounters {
  return {
    raids: [
      {
        instanceId,
        instanceName: catalog.name,
        difficulties: modes.map((mode) => ({
          difficulty: mode.difficulty,
          progressCompleted: mode.kills.filter((kill) => kill.lastKillTimestampMs != null).length,
          progressTotal: catalog.bosses.length,
          encounters: mode.kills.map((kill) => {
            const boss = catalog.bosses[kill.bossIndex]!;
            return {
              encounterId: String(10_000 + kill.bossIndex),
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

describe("deriveCurrentResetLockouts", () => {
  it("marks kills by timestamp relative to the injected reset window", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: encountersFor([
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
    expect(normal.bosses[0]?.killedThisReset).toBe(true);
    expect(normal.bosses[1]?.killedThisReset).toBe(false);
    expect(normal.bosses[2]?.killedThisReset).toBe(false);
    expect(normal.bossesDefeated).toBe(1);
  });

  it("keeps Normal / Heroic / Mythic independent", () => {
    const allCurrent = catalog.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const noneCurrent = catalog.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killBeforeReset,
    }));

    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: encountersFor([
        { difficulty: "NORMAL", kills: allCurrent },
        { difficulty: "HEROIC", kills: noneCurrent },
        { difficulty: "MYTHIC", kills: allCurrent.slice(0, 3) },
      ]),
    });

    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;

    const byDiff = Object.fromEntries(result.difficulties.map((row) => [row.difficulty, row]));
    expect(byDiff.NORMAL?.bossesDefeated).toBe(8);
    expect(byDiff.HEROIC?.bossesDefeated).toBe(0);
    expect(byDiff.MYTHIC?.bossesDefeated).toBe(3);
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC 0/8 · M 3/8");
  });

  it("treats successful zero kills as 0/N clear, not unknown", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: encountersFor([
        {
          difficulty: "HEROIC",
          kills: catalog.bosses.map((_, bossIndex) => ({
            bossIndex,
            lastKillTimestampMs: null,
          })),
        },
      ]),
    });

    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    const heroic = result.difficulties.find((row) => row.difficulty === "HEROIC")!;
    expect(heroic.bossesDefeated).toBe(0);
    expect(heroic.isComplete).toBe(false);
  });

  it("returns unknown when the current catalog raid is missing", () => {
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: {
        raids: [
          {
            instanceId: "1",
            instanceName: "Ancient Historical Raid",
            difficulties: [],
          },
        ],
      },
    });
    expect(result.status).toBe("unknown");
  });

  it("matches realistic fixture A: N 8/8 and HC 8/8", () => {
    const allCurrent = catalog.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: encountersFor([
        { difficulty: "NORMAL", kills: allCurrent },
        { difficulty: "HEROIC", kills: allCurrent },
      ]),
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC 8/8 · M 0/8");
  });

  it("matches realistic fixture B: N 8/8 and HC 0/8", () => {
    const allCurrent = catalog.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: killInReset,
    }));
    const none = catalog.bosses.map((_, bossIndex) => ({
      bossIndex,
      lastKillTimestampMs: null,
    }));
    const result = deriveCurrentResetLockouts({
      region: "EU",
      now,
      resetWindow: reset,
      encounters: encountersFor([
        { difficulty: "NORMAL", kills: allCurrent },
        { difficulty: "HEROIC", kills: none },
      ]),
    });
    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(formatCompactLockoutProgress(result.difficulties)).toBe("N 8/8 · HC 0/8 · M 0/8");
  });
});
