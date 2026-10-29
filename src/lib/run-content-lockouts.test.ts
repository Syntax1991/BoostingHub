import { describe, expect, it } from "vitest";
import { fixtureRaidCatalog } from "@/lib/raid-catalog";
import { isSaveRelevantToPlannedBosses, projectRunContentLockouts } from "@/lib/run-content-lockouts";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { RaidDifficulty } from "@/models/enums";

const catalog = fixtureRaidCatalog();
const venomousBosses = catalog.findById(VENOMOUS_ABYSS_RAID_ID)!.bosses;
const bossId = (number: number) => [...venomousBosses].sort((a, b) => a.sortOrder - b.sortOrder)[number - 1]!.id;

/** One Venomous content (8 bosses), `planned` of them planned, with the given verified save (null = Unknown). */
function row(input: {
  planned: number;
  difficulty?: RaidDifficulty;
  save?: { killed: number[] | null; defeated?: number; complete?: boolean; unknownIds?: string[] } | null;
  bosses?: typeof venomousBosses;
}) {
  const difficulty = input.difficulty ?? "HEROIC";
  const save = input.save;
  return projectRunContentLockouts({
    contents: [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 0,
        plannedBossCount: input.planned,
        totalBossCount: 8,
        bosses: input.bosses ?? venomousBosses,
      },
    ],
    difficulty,
    lootType: "UNSAVED",
    findSave: () =>
      save == null
        ? null
        : {
            raidId: VENOMOUS_ABYSS_RAID_ID,
            difficulty,
            resetIdentifier: "r",
            bossesDefeated: save.defeated ?? save.killed?.length ?? 0,
            totalBossCount: 8,
            isComplete: save.complete ?? false,
            ...(save.killed ? { killedBossIds: [...save.killed.map(bossId), ...(save.unknownIds ?? [])] } : {}),
          },
  })[0]!;
}

describe("isSaveRelevantToPlannedBosses", () => {
  it("Heroic 1/8 with only boss 8 killed: not relevant for bosses 1–6, relevant once the Run includes boss 8", () => {
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [8] } }))).toBe(false);
    expect(isSaveRelevantToPlannedBosses(row({ planned: 8, save: { killed: [8] } }))).toBe(true);
  });

  it("several kills: relevant as soon as one overlaps the planned bosses", () => {
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [7, 8] } }))).toBe(false);
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [6, 7, 8] } }))).toBe(true);
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [1] } }))).toBe(true);
  });

  it("Mythic binds the instance: any kill is relevant, also with no overlap", () => {
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, difficulty: "MYTHIC", save: { killed: [8] } }))).toBe(true);
  });

  it("full clear is always relevant, even with an unknown boss list", () => {
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: null, defeated: 8, complete: true } }))).toBe(
      true,
    );
  });

  it("conservative when it cannot be proven safe: unknown kill list or missing planned-boss list", () => {
    // Progress without a boss list (older sync): which boss is unknown → relevant.
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: null, defeated: 1 } }))).toBe(true);
    // The content's boss list is missing: planned bosses unknown → relevant.
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, bosses: [], save: { killed: [8] } }))).toBe(true);
  });

  it("an incomplete or unrecognised boss list never proves a save harmless", () => {
    // 2/8 verified, but only boss 8 is in the list (e.g. an id dropped by a catalog merge) → relevant.
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [8], defeated: 2 } }))).toBe(true);
    // 1/8 verified, the only stored id is not a boss of this content's catalog → relevant.
    expect(
      isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [], defeated: 1, unknownIds: ["not-a-catalog-boss"] } })),
    ).toBe(true);
    // A complete list still proves it: 1/8 with exactly boss 8 → not relevant, 1/8 with boss 2 → relevant.
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [8], defeated: 1 } }))).toBe(false);
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [2], defeated: 1 } }))).toBe(true);
  });

  it("no verified save (Unknown) or verified 0 kills is not a save", () => {
    const unknown = row({ planned: 6, save: null });
    expect(unknown.label.kind).toBe("unknown");
    expect(isSaveRelevantToPlannedBosses(unknown)).toBe(false);
    // Zero progress with consistent empty kill data.
    expect(isSaveRelevantToPlannedBosses(row({ planned: 6, save: { killed: [], defeated: 0 } }))).toBe(false);
  });
});
