import { orm } from "@/lib/prisma";
import { asBoolean, asString } from "@/lib/persistence";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";

export type RaidRecord = {
  id: string;
  name: string;
  season: string;
  isActive: boolean;
};

function mapRaid(row: Record<string, unknown>): RaidRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    season: asString(row.season),
    isActive: asBoolean(row.isActive, true),
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

  async listActive(): Promise<RaidRecord[]> {
    const rows = await orm.Raid.orderBy((raid) => raid.name.asc()).all();
    return rows.map((row) => mapRaid(row as Record<string, unknown>)).filter((raid) => raid.isActive);
  },

  async findById(id: string): Promise<RaidRecord | null> {
    const row = await orm.Raid.where({ id }).first();
    return row ? mapRaid(row as Record<string, unknown>) : null;
  },
};
