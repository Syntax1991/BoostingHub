import { describe, expect, it } from "vitest";
import {
  buildRaidCatalog,
  fixtureRaidCatalog,
  parseEncounterIds,
  serializeEncounterIds,
  type CatalogRaid,
} from "@/lib/raid-catalog";
import {
  MANAFORGE_OMEGA_RAID_ID,
  NYMRISSA_WAVECALLER_BOSS_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

function raid(overrides: Partial<CatalogRaid> & Pick<CatalogRaid, "id">): CatalogRaid {
  return {
    name: overrides.id,
    season: "S",
    availableForRuns: false,
    sortOrder: 0,
    trackLockouts: false,
    blizzardInstanceId: null,
    wclZoneId: null,
    wclRankingEncounterId: null,
    bosses: [],
    ...overrides,
  };
}

describe("encounter id storage", () => {
  it("round-trips JSON number arrays and treats anything else as empty", () => {
    expect(parseEncounterIds(serializeEncounterIds([2849, 3379]))).toEqual([2849, 3379]);
    for (const value of [null, undefined, "", "nope", "{}", '["2849"]', 42]) {
      expect(parseEncounterIds(value)).toEqual([]);
    }
    expect(parseEncounterIds("[1, 2.5, 3]")).toEqual([1, 3]);
  });
});

describe("buildRaidCatalog", () => {
  it("orders raids by sortOrder and derives the tracked lockout set from trackLockouts", () => {
    const catalog = buildRaidCatalog([
      raid({ id: "c", sortOrder: 3, trackLockouts: true }),
      raid({ id: "a", sortOrder: 1 }),
      raid({ id: "b", sortOrder: 2, trackLockouts: true }),
    ]);
    expect(catalog.raids.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(catalog.lockoutRaids.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("maps WCL encounters to raids from WCL ids only — never Blizzard ids", () => {
    const catalog = buildRaidCatalog([
      raid({
        id: "r",
        bosses: [
          { id: "b1", raidId: "r", name: "B", sortOrder: 1, blizzardEncounterIds: [111], wclEncounterIds: [222] },
        ],
      }),
    ]);
    expect(catalog.raidIdByWclEncounterId.get(222)).toBe("r");
    expect(catalog.raidIdByWclEncounterId.has(111)).toBe(false);
  });

  it("orders bosses and counts them per explicit raid id", () => {
    const catalog = buildRaidCatalog([
      raid({
        id: "r",
        bosses: [
          { id: "2", raidId: "r", name: "Second", sortOrder: 2, blizzardEncounterIds: [], wclEncounterIds: [] },
          { id: "1", raidId: "r", name: "First", sortOrder: 1, blizzardEncounterIds: [], wclEncounterIds: [] },
        ],
      }),
    ]);
    expect(catalog.findById("r")!.bosses.map((boss) => boss.name)).toEqual(["First", "Second"]);
    expect(catalog.bossTotal("r")).toBe(2);
    expect(catalog.bossTotal("missing")).toBe(0);
    expect(catalog.findById("missing")).toBeNull();
  });
});

describe("bootstrap fixture catalog", () => {
  const catalog = fixtureRaidCatalog();

  it("tracks exactly Venomous then Tide for lockouts (Manaforge historical)", () => {
    expect(catalog.lockoutRaids.map((row) => row.id)).toEqual([VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID]);
    expect(catalog.findById(MANAFORGE_OMEGA_RAID_ID)!.trackLockouts).toBe(false);
  });

  it("keeps zone 53 shared by Venomous and Tide with Nymrissa encounter-scoped", () => {
    expect(catalog.findById(VENOMOUS_ABYSS_RAID_ID)).toMatchObject({ wclZoneId: 53, wclRankingEncounterId: null });
    expect(catalog.findById(TIDEBOUND_GROTTO_RAID_ID)).toMatchObject({ wclZoneId: 53, wclRankingEncounterId: 3379 });
    expect(catalog.findById(MANAFORGE_OMEGA_RAID_ID)).toMatchObject({ wclZoneId: null, blizzardInstanceId: 1302 });
    expect(catalog.raidIdByWclEncounterId.get(3379)).toBe(TIDEBOUND_GROTTO_RAID_ID);
    expect(catalog.raidIdByWclEncounterId.get(3470)).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(catalog.raidIdByWclEncounterId.get(3129)).toBe(MANAFORGE_OMEGA_RAID_ID);
    expect(catalog.findById(TIDEBOUND_GROTTO_RAID_ID)!.bosses[0]).toMatchObject({
      id: NYMRISSA_WAVECALLER_BOSS_ID,
      blizzardEncounterIds: [2849],
      wclEncounterIds: [3379],
    });
  });
});
