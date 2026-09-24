import { describe, expect, it } from "vitest";
import { lockoutBossBreakdown, parseKilledBossIds, serializeKilledBossIds } from "@/lib/lockout-bosses";
import { formatContentLockoutTooltip, projectRunContentLockouts } from "@/lib/run-content-lockouts";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";

const FIRST = "bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD = "bb000003-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("lockout boss breakdown", () => {
  it("round-trips the stored JSON and treats anything else as unknown", () => {
    expect(parseKilledBossIds(serializeKilledBossIds([FIRST, THIRD]))).toEqual([FIRST, THIRD]);
    for (const unknown of [null, undefined, "", "not json", "{}", "[1,2]"]) {
      expect(parseKilledBossIds(unknown)).toBeNull();
    }
  });

  it("lists every catalog boss in order with its kill state", () => {
    const bosses = lockoutBossBreakdown(VENOMOUS_ABYSS_RAID_ID, [THIRD, FIRST])!;
    expect(bosses).toHaveLength(8);
    expect(bosses.slice(0, 3)).toEqual([
      { name: "Nek'zali the Soulcoiler", killed: true },
      { name: "Entombed Sentinels", killed: false },
      { name: "The Lost Explorers", killed: true },
    ]);
    expect(bosses.filter((boss) => boss.killed)).toHaveLength(2);
    expect(lockoutBossBreakdown(VENOMOUS_ABYSS_RAID_ID, null)).toBeNull();
    expect(lockoutBossBreakdown("unknown-raid", [FIRST])).toBeNull();
  });

  it("tooltip: killed/open bosses per content, and honest fallbacks", () => {
    const rows = projectRunContentLockouts({
      contents: [
        { raidId: TIDEBOUND_GROTTO_RAID_ID, raidName: "The Tidebound Grotto", sortOrder: 0, plannedBossCount: 1, totalBossCount: 1 },
        { raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", sortOrder: 1, plannedBossCount: 8, totalBossCount: 8 },
      ],
      difficulty: "HEROIC",
      lootType: "VIP",
      findSave: (content) =>
        content.raidId === VENOMOUS_ABYSS_RAID_ID
          ? {
              raidId: content.raidId,
              difficulty: "HEROIC",
              resetIdentifier: "r",
              bossesDefeated: 1,
              totalBossCount: 8,
              isComplete: false,
              killedBossIds: [FIRST],
            }
          : null,
    });
    const lines = formatContentLockoutTooltip(rows).split("\n");
    expect(lines[0]).toBe("Tide: lockout unknown");
    expect(lines[1]).toMatch(/^The Venomous Abyss: ✓ Nek'zali the Soulcoiler · ✗ Entombed Sentinels/);

    const legacy = projectRunContentLockouts({
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", sortOrder: 0, plannedBossCount: 8, totalBossCount: 8 }],
      difficulty: "HEROIC",
      lootType: "VIP",
      findSave: () => ({
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "HEROIC",
        resetIdentifier: "r",
        bossesDefeated: 3,
        totalBossCount: 8,
        isComplete: false,
      }),
    });
    expect(formatContentLockoutTooltip(legacy)).toBe("The Venomous Abyss: boss details after the next character sync");
  });
});
