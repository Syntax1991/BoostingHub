/**
 * BoostingHub raid seasons — which Blizzard journal instances form a season.
 *
 * Blizzard has no raid-season membership API (the journal tier "Current Season"
 * lists every raid of the expansion, world bosses included), so seasons are
 * small version-controlled definitions. Add the next season here; there is no
 * season CRUD UI. `name` is written to `Raid.season` when a raid is imported.
 *
 * Journal instance ids verified against `GET /data/wow/journal-instance/{id}`
 * (static namespace) on 2026-10-23.
 */
export type RaidSeasonDefinition = {
  key: string;
  name: string;
  /** Current season: newly imported raids track Blizzard lockouts by default. */
  current: boolean;
  /** Journal instance ids, in raid order. */
  journalInstanceIds: readonly number[];
};

export const RAID_SEASONS: readonly RaidSeasonDefinition[] = [
  {
    key: "MIDNIGHT_S2",
    name: "Midnight Season 2",
    current: true,
    // The Venomous Abyss, The Tidebound Grotto, The Unbinding of Kith'ix.
    journalInstanceIds: [1320, 1317, 1324],
  },
  {
    key: "MIDNIGHT_S1",
    name: "Midnight Season 1",
    current: false,
    // The Voidspire, The Dreamrift, March on Quel'Danas.
    journalInstanceIds: [1307, 1314, 1308],
  },
  {
    key: "TWW_S3",
    name: "The War Within Season 3",
    current: false,
    // Manaforge Omega.
    journalInstanceIds: [1302],
  },
];

export function findRaidSeason(key: string): RaidSeasonDefinition | null {
  return RAID_SEASONS.find((season) => season.key === key) ?? null;
}

/** The first season definition containing a journal instance (newest first). */
export function findRaidSeasonForInstance(journalInstanceId: number): RaidSeasonDefinition | null {
  return (
    RAID_SEASONS.find((season) => season.journalInstanceIds.includes(journalInstanceId)) ?? null
  );
}
