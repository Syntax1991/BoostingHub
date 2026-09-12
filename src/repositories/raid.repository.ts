import { orm } from "@/lib/prisma";
import { asBoolean, asString } from "@/lib/persistence";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";

export type RaidRecord = {
  id: string;
  name: string;
  season: string;
  /**
   * Whether Users may select this raid for a NEW Run. Independent of
   * `currentForLockouts` (Blizzard lockout derivation target) — a raid can
   * be historical (availableForRuns: false) while its data, bosses, and
   * every historical Run/lockout relation referencing it remain intact and
   * fully readable forever. Never inferred by callers; always read from here.
   * Persisted on the `Raid.isActive` column (no separate column/migration).
   */
  availableForRuns: boolean;
  /** Computed from RaidBoss rows — never a separate stored total. */
  totalBossCount: number;
};

function mapRaid(row: Record<string, unknown>): RaidRecord {
  const bosses = Array.isArray(row.bosses) ? row.bosses : [];
  return {
    id: asString(row.id),
    name: asString(row.name),
    season: asString(row.season),
    availableForRuns: asBoolean(row.isActive, true),
    totalBossCount: bosses.length,
  };
}

/**
 * Idempotent bootstrap of supported raid content. Independent of demo users and demo Runs.
 * Existing bosses matched by catalog id or name are updated in place so prior seed IDs stay valid.
 * `availableForRuns` controls Raid.isActive for create-run options.
 */
export const raidRepository = {
  async ensureReferenceRaids(now = new Date().toISOString()): Promise<void> {
    for (const raid of WOW_RAID_CATALOG) {
      const existing = await orm.Raid.where({ id: raid.id }).first();
      if (existing) {
        await orm.Raid.where({ id: raid.id }).update({
          name: raid.name,
          season: raid.season,
          isActive: raid.availableForRuns,
          updatedAt: now,
        });
      } else {
        await orm.Raid.create({
          id: raid.id,
          name: raid.name,
          season: raid.season,
          isActive: raid.availableForRuns,
          createdAt: now,
          updatedAt: now,
        });
      }

      const bosses = await orm.RaidBoss.where({ raidId: raid.id }).all();
      const byId = new Map(bosses.map((boss) => [asString(boss.id), boss]));
      const byName = new Map(bosses.map((boss) => [asString(boss.name), boss]));

      for (const boss of raid.bosses) {
        const match = byId.get(boss.id) ?? byName.get(boss.name);
        if (match) {
          await orm.RaidBoss.where({ id: asString(match.id) }).update({
            name: boss.name,
            sortOrder: boss.sortOrder,
          });
          continue;
        }
        await orm.RaidBoss.create({
          id: boss.id,
          raidId: raid.id,
          name: boss.name,
          sortOrder: boss.sortOrder,
        });
      }
    }
  },

  /** Raids selectable for a NEW Run. Historical raids are deliberately excluded. */
  async listAvailableForRuns(): Promise<RaidRecord[]> {
    const rows = await orm.Raid.include("bosses").orderBy((raid) => raid.name.asc()).all();
    return rows
      .map((row) => mapRaid(row as Record<string, unknown>))
      .filter((raid) => raid.availableForRuns);
  },

  /** Every raid, including historical ones — used for existing-Run reads, never for new-Run selection. */
  async findById(id: string): Promise<RaidRecord | null> {
    const row = await orm.Raid.where({ id }).include("bosses").first();
    return row ? mapRaid(row as Record<string, unknown>) : null;
  },

  /**
   * Batched lookup for callers resolving several raids at once (e.g. mass Run
   * creation) — one query regardless of how many distinct ids are requested,
   * avoiding a findById-per-row N+1. Includes historical raids; callers that
   * only want new-Run-eligible ones must check `availableForRuns` themselves.
   */
  async listByIds(ids: string[]): Promise<RaidRecord[]> {
    if (ids.length === 0) return [];
    const rows = await orm.Raid.where((raid) => raid.id.in(ids)).include("bosses").all();
    return rows.map((row) => mapRaid(row as Record<string, unknown>));
  },
};
