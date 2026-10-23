import { describe, expect, it } from "vitest";
import type { CatalogRaid } from "@/lib/raid-catalog";
import { findImportTarget, planRaidImport } from "@/services/raid-catalog-import-plan";

const kithix: CatalogRaid = {
  id: "raid-kithix",
  name: "The Unbinding of Kith'ix",
  season: "Midnight Season 2",
  availableForRuns: false,
  sortOrder: 4,
  trackLockouts: true,
  blizzardInstanceId: 1324,
  wclZoneId: 53,
  wclRankingEncounterId: null,
  bosses: [
    {
      id: "boss-kithix",
      raidId: "raid-kithix",
      name: "The Unbinding of Kith'ix",
      sortOrder: 1,
      blizzardEncounterIds: [2896],
      wclEncounterIds: [3513],
    },
  ],
};

describe("planRaidImport", () => {
  it("keeps boss identity by encounter id and renames to Blizzard's boss name", () => {
    const journal = {
      instanceId: 1324,
      name: "The Unbinding of Kith'ix",
      encounters: [{ id: 2896, name: "Kith'ix" }],
    };
    const plan = planRaidImport({
      journal,
      target: findImportTarget([kithix], journal),
      structureLocked: true,
    });
    expect(plan.status).toBe("UPDATE_AVAILABLE");
    expect(plan.bosses).toEqual([
      expect.objectContaining({
        bossId: "boss-kithix",
        name: "Kith'ix",
        previousName: "The Unbinding of Kith'ix",
        blizzardEncounterIds: [2896],
      }),
    ]);
    expect(plan.staleBosses).toEqual([]);
    expect(plan.unaddedEncounters).toEqual([]);
  });

  it("pairs a one-boss raid with a one-encounter instance even when names and stale ids differ", () => {
    const stale = { ...kithix, bosses: [{ ...kithix.bosses[0]!, blizzardEncounterIds: [3271] }] };
    const journal = {
      instanceId: 1324,
      name: "The Unbinding of Kith'ix",
      encounters: [{ id: 2896, name: "Kith'ix" }],
    };
    const plan = planRaidImport({
      journal,
      target: findImportTarget([stale], journal),
      structureLocked: true,
    });
    expect(plan.bosses[0]).toMatchObject({ bossId: "boss-kithix", blizzardEncounterIds: [2896] });
  });

  it("never adopts a raid linked to another instance", () => {
    const journal = {
      instanceId: 9999,
      name: "The Unbinding of Kith'ix",
      encounters: [{ id: 1, name: "Kith'ix" }],
    };
    expect(findImportTarget([kithix], journal)).toBeNull();
  });
});
