import { describe, expect, it } from "vitest";
import type { WarcraftLogsCatalogZone } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  catalogMatchKey,
  discoverWarcraftLogsRaidMetadata,
  resolveWarcraftLogsRaidMetadata,
} from "@/services/warcraft-logs-raid-metadata.service";
import type { CatalogRaid } from "@/lib/raid-catalog";

const ZONE_53: WarcraftLogsCatalogZone = {
  id: 53,
  name: "Venomous Abyss",
  encounters: [
    { id: 3470, name: "Nek'zali the Soulcoiler", journalId: 2888 },
    { id: 3445, name: "Entombed Sentinels", journalId: 2874 },
    { id: 3379, name: "Nymrissa Wavecaller", journalId: 2849 },
    { id: 3492, name: "Ula'tek", journalId: 2895 },
  ],
};

const ZONE_44: WarcraftLogsCatalogZone = {
  id: 44,
  name: "Manaforge Omega",
  encounters: [{ id: 3129, name: "Plexus Sentinel", journalId: 2684 }],
};

function raid(partial: Partial<CatalogRaid> & Pick<CatalogRaid, "name" | "bosses">): CatalogRaid {
  return {
    id: "raid-1",
    season: "QA",
    sortOrder: 1,
    trackLockouts: false,
    availableForRuns: false,
    blizzardInstanceId: null,
    wclZoneId: null,
    wclRankingEncounterId: null,
    ...partial,
  };
}

describe("catalogMatchKey", () => {
  it("normalizes and strips a leading the", () => {
    expect(catalogMatchKey("The Venomous Abyss")).toBe(catalogMatchKey("Venomous Abyss"));
  });
});

describe("resolveWarcraftLogsRaidMetadata", () => {
  it("resolves a multi-boss raid zone by exact name and leaves ranking null", () => {
    const result = resolveWarcraftLogsRaidMetadata(
      raid({
        name: "The Venomous Abyss",
        bosses: [
          {
            id: "b1",
            raidId: "raid-1",
            name: "Nek'zali the Soulcoiler",
            sortOrder: 1,
            blizzardEncounterIds: [],
            wclEncounterIds: [],
          },
          {
            id: "b2",
            raidId: "raid-1",
            name: "Entombed Sentinels",
            sortOrder: 2,
            blizzardEncounterIds: [],
            wclEncounterIds: [],
          },
        ],
      }),
      [ZONE_53, ZONE_44],
    );
    expect(result).toMatchObject({
      status: "RESOLVED",
      wclZoneId: 53,
      wclRankingEncounterId: null,
    });
    if (result.status !== "RESOLVED") return;
    expect(result.encounterMappings).toEqual([
      { bossId: "b1", wclEncounterIds: [3470], blizzardEncounterIds: [2888] },
      { bossId: "b2", wclEncounterIds: [3445], blizzardEncounterIds: [2874] },
    ]);
  });

  it("derives shared-zone ranking encounter for a single-boss lair by boss name", () => {
    const result = resolveWarcraftLogsRaidMetadata(
      raid({
        name: "The Tidebound Grotto",
        bosses: [
          {
            id: "nym",
            raidId: "raid-1",
            name: "Nymrissa Wavecaller",
            sortOrder: 1,
            blizzardEncounterIds: [],
            wclEncounterIds: [],
          },
        ],
      }),
      [ZONE_53, ZONE_44],
    );
    expect(result).toEqual({
      status: "RESOLVED",
      wclZoneId: 53,
      wclRankingEncounterId: 3379,
      encounterMappings: [{ bossId: "nym", wclEncounterIds: [3379], blizzardEncounterIds: [2849] }],
    });
  });

  it("does not guess when multiple zones share the same normalized name", () => {
    const duplicate: WarcraftLogsCatalogZone = { ...ZONE_53, id: 99 };
    const result = resolveWarcraftLogsRaidMetadata(
      raid({ name: "Venomous Abyss", bosses: [] }),
      [ZONE_53, duplicate],
    );
    expect(result).toEqual({ status: "UNRESOLVED", reason: "AMBIGUOUS" });
  });

  it("leaves unresolved when there is no safe match", () => {
    expect(resolveWarcraftLogsRaidMetadata(raid({ name: "Unknown Lair", bosses: [] }), [ZONE_53])).toEqual({
      status: "UNRESOLVED",
      reason: "NO_MATCH",
    });
  });
});

describe("discoverWarcraftLogsRaidMetadata", () => {
  it("does not erase an existing mapping on soft discovery", async () => {
    const existing = raid({
      name: "The Venomous Abyss",
      wclZoneId: 53,
      wclRankingEncounterId: null,
      bosses: [],
    });
    const result = await discoverWarcraftLogsRaidMetadata(existing, {
      fetchZones: async () => ({ status: "SUCCESS", zones: [ZONE_53] }),
    });
    expect(result.raidPatch).toBeNull();
    expect(result.resolution).toMatchObject({ status: "RESOLVED", wclZoneId: 53 });
  });

  it("force retry overwrites the raid mapping", async () => {
    const existing = raid({
      name: "The Venomous Abyss",
      wclZoneId: 1,
      wclRankingEncounterId: 2,
      bosses: [],
    });
    const result = await discoverWarcraftLogsRaidMetadata(existing, {
      force: true,
      fetchZones: async () => ({ status: "SUCCESS", zones: [ZONE_53] }),
    });
    expect(result.raidPatch).toEqual({ wclZoneId: 53, wclRankingEncounterId: null });
  });

  it("treats WCL outages as unresolved without throwing", async () => {
    const result = await discoverWarcraftLogsRaidMetadata(raid({ name: "The Venomous Abyss", bosses: [] }), {
      fetchZones: async () => ({ status: "TEMPORARY_FAILURE", message: "timeout" }),
    });
    expect(result).toEqual({
      resolution: { status: "UNRESOLVED", reason: "UNAVAILABLE" },
      raidPatch: null,
      encounterPatches: [],
    });
  });
});
