import { describe, expect, it } from "vitest";
import type { BlizzardJournalInstance } from "@/lib/blizzard/types";
import {
  discoverBlizzardRaidMetadata,
  resolveJournalEncounters,
  resolveJournalInstanceId,
} from "@/services/blizzard-raid-metadata.service";

/** Shapes as returned by the live journal API (verified 2026-10-23, static-eu). */
const INDEX = [
  { id: 65, name: "Throne of the Tides" },
  { id: 1317, name: "The Tidebound Grotto" },
  { id: 1320, name: "The Venomous Abyss" },
  { id: 1324, name: "The Unbinding of Kith'ix" },
];
const INSTANCES: Record<number, BlizzardJournalInstance> = {
  1324: { id: 1324, name: "The Unbinding of Kith'ix", category: "RAID", encounters: [{ id: 2896, name: "Kith'ix" }] },
  1320: {
    id: 1320,
    name: "The Venomous Abyss",
    category: "RAID",
    encounters: [
      { id: 2888, name: "Nek'zali the Soulcoiler" },
      { id: 2874, name: "Entombed Sentinels" },
    ],
  },
  65: { id: 65, name: "Throne of the Tides", category: "DUNGEON", encounters: [{ id: 101, name: "Lady Naz'jar" }] },
};
const fetchers = {
  fetchIndex: async () => INDEX,
  fetchInstance: async (id: number) => INSTANCES[id] ?? null,
};

function raid(name: string, bosses: Array<{ id: string; name: string }>, blizzardInstanceId: number | null = null) {
  return {
    id: `raid-${name}`,
    name,
    blizzardInstanceId,
    bosses: bosses.map((boss, index) => ({
      ...boss,
      raidId: `raid-${name}`,
      sortOrder: index + 1,
      blizzardEncounterIds: [],
      wclEncounterIds: [],
    })),
  };
}

describe("Blizzard journal raid matching", () => {
  it("matches the instance by exact (normalized) name only", () => {
    expect(resolveJournalInstanceId("The Unbinding of Kith'ix", INDEX)).toEqual({ id: 1324 });
    expect(resolveJournalInstanceId("unbinding of kith'ix", INDEX)).toEqual({ id: 1324 });
    expect(resolveJournalInstanceId("Kith'ix", INDEX)).toEqual({ unresolved: "NO_MATCH" });
    expect(resolveJournalInstanceId("Tidebound Grotto", [...INDEX, { id: 9, name: "The Tidebound Grotto" }])).toEqual({
      unresolved: "AMBIGUOUS",
    });
  });

  it("maps bosses by exact name; a single-boss raid maps to a single-encounter instance", () => {
    expect(resolveJournalEncounters([{ id: "k", name: "The Unbinding of Kith'ix" }], INSTANCES[1324]!)).toEqual([
      { bossId: "k", blizzardEncounterIds: [2896] },
    ]);
    expect(
      resolveJournalEncounters(
        [
          { id: "a", name: "Entombed Sentinels" },
          { id: "b", name: "Some Other Boss" },
        ],
        INSTANCES[1320]!,
      ),
    ).toEqual([{ bossId: "a", blizzardEncounterIds: [2874] }]);
  });
});

describe("discoverBlizzardRaidMetadata", () => {
  it("resolves The Unbinding of Kith'ix to journal instance 1324 / encounter 2896, ignoring a wrong stored id", async () => {
    const result = await discoverBlizzardRaidMetadata(
      raid("The Unbinding of Kith'ix", [{ id: "k", name: "The Unbinding of Kith'ix" }], 17059),
      fetchers,
    );
    expect(result).toEqual({
      status: "RESOLVED",
      blizzardInstanceId: 1324,
      encounterMappings: [{ bossId: "k", blizzardEncounterIds: [2896] }],
    });
  });

  it("falls back to the stored id when the name has no journal match", async () => {
    const result = await discoverBlizzardRaidMetadata(raid("Venomous Abyss (Midnight S2)", [], 1320), fetchers);
    expect(result).toMatchObject({ status: "RESOLVED", blizzardInstanceId: 1320 });
  });

  it("never guesses: unknown name and unknown stored id, non-raid instance, outage", async () => {
    expect(await discoverBlizzardRaidMetadata(raid("Unknown Lair", [], 17059), fetchers)).toEqual({
      status: "UNRESOLVED",
      reason: "NO_MATCH",
    });
    expect(await discoverBlizzardRaidMetadata(raid("Throne of the Tides", []), fetchers)).toEqual({
      status: "UNRESOLVED",
      reason: "NOT_RAID",
    });
    expect(
      await discoverBlizzardRaidMetadata(raid("The Venomous Abyss", []), {
        fetchIndex: async () => {
          throw new Error("Battle.net down");
        },
        fetchInstance: fetchers.fetchInstance,
      }),
    ).toEqual({ status: "UNRESOLVED", reason: "UNAVAILABLE" });
  });
});
