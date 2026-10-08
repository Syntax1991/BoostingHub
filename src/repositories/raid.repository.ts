import { orm } from "@/lib/prisma";
import { asBoolean, asNumber, asNumberOrNull, asString } from "@/lib/persistence";
import { PRODUCT_CATALOG_FIXTURE } from "@/lib/product-catalog";
import {
  buildRaidCatalog,
  parseEncounterIds,
  serializeEncounterIds,
  type CatalogBoss,
  type CatalogRaid,
  type RaidCatalog,
} from "@/lib/raid-catalog";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";

export type RaidRecord = {
  id: string;
  name: string;
  season: string;
  /**
   * Whether Users may select this raid for a NEW Run. Independent of
   * `trackLockouts` (Blizzard lockout derivation target) — a raid can
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

function mapCatalogBoss(row: Record<string, unknown>): CatalogBoss {
  return {
    id: asString(row.id),
    raidId: asString(row.raidId),
    name: asString(row.name),
    sortOrder: asNumber(row.sortOrder, 0),
    blizzardEncounterIds: parseEncounterIds(row.blizzardEncounterIds),
    wclEncounterIds: parseEncounterIds(row.wclEncounterIds),
  };
}

function mapCatalogRaid(row: Record<string, unknown>): CatalogRaid {
  const bosses = Array.isArray(row.bosses) ? (row.bosses as Array<Record<string, unknown>>) : [];
  return {
    id: asString(row.id),
    name: asString(row.name),
    season: asString(row.season),
    availableForRuns: asBoolean(row.isActive, true),
    sortOrder: asNumber(row.sortOrder, 0),
    trackLockouts: asBoolean(row.trackLockouts, false),
    blizzardInstanceId: asNumberOrNull(row.blizzardInstanceId),
    wclZoneId: asNumberOrNull(row.wclZoneId),
    wclRankingEncounterId: asNumberOrNull(row.wclRankingEncounterId),
    bosses: bosses.map(mapCatalogBoss),
  };
}

/**
 * Insert-only bootstrap of the bootstrap fixtures (`WOW_RAID_CATALOG`,
 * `PRODUCT_CATALOG_FIXTURE`). Missing rows are created with their stable
 * UUIDs; existing rows are NEVER updated — the database is the authority once
 * a row exists (future admin edits must survive every write path that calls
 * this). Two read queries when nothing is missing.
 */
async function ensureReferenceRaids(now = new Date().toISOString()): Promise<void> {
  const raidRows = (await orm.Raid.include("bosses").all()) as Array<Record<string, unknown>>;
  const existingRaidIds = new Set(raidRows.map((row) => asString(row.id)));
  const existingBossIds = new Set<string>();
  const existingBossNames = new Set<string>();
  for (const raid of raidRows) {
    const bosses = Array.isArray(raid.bosses) ? (raid.bosses as Array<Record<string, unknown>>) : [];
    for (const boss of bosses) {
      existingBossIds.add(asString(boss.id));
      existingBossNames.add(`${asString(boss.raidId)}\u0000${asString(boss.name)}`);
    }
  }

  for (const raid of WOW_RAID_CATALOG) {
    if (!existingRaidIds.has(raid.id)) {
      await orm.Raid.create({
        id: raid.id,
        name: raid.name,
        season: raid.season,
        isActive: raid.availableForRuns,
        sortOrder: raid.sortOrder,
        trackLockouts: raid.trackLockouts,
        blizzardInstanceId: raid.blizzardInstanceId,
        wclZoneId: raid.warcraftLogsZoneId ?? null,
        wclRankingEncounterId: raid.warcraftLogsEncounterId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const boss of raid.bosses) {
      // A same-named boss under another id is an existing identity — never duplicate it.
      if (existingBossIds.has(boss.id) || existingBossNames.has(`${raid.id}\u0000${boss.name}`)) continue;
      await orm.RaidBoss.create({
        id: boss.id,
        raidId: raid.id,
        name: boss.name,
        sortOrder: boss.sortOrder,
        blizzardEncounterIds: serializeEncounterIds(boss.blizzardEncounterIds),
        wclEncounterIds: serializeEncounterIds(boss.warcraftLogsEncounterIds ?? []),
      });
    }
  }

  const productRows = (await orm.Product.include("contents").all()) as Array<Record<string, unknown>>;
  const productIdByKey = new Map(productRows.map((row) => [asString(row.key), asString(row.id)]));
  const existingContentIds = new Set<string>();
  const occupiedContentSlots = new Set<string>();
  for (const product of productRows) {
    const contents = Array.isArray(product.contents) ? (product.contents as Array<Record<string, unknown>>) : [];
    for (const content of contents) {
      existingContentIds.add(asString(content.id));
      occupiedContentSlots.add(`${asString(content.productId)}\u0000raid\u0000${asString(content.raidId)}`);
      occupiedContentSlots.add(`${asString(content.productId)}\u0000order\u0000${asNumber(content.sortOrder, 0)}`);
    }
  }

  for (const product of PRODUCT_CATALOG_FIXTURE) {
    const existingProductId = productIdByKey.get(product.key);
    if (existingProductId && existingProductId !== product.id) continue; // key owned by another product row
    if (!existingProductId) {
      await orm.Product.create({
        id: product.id,
        key: product.key,
        name: product.name,
        active: product.active,
        selectable: product.selectable,
        sortOrder: product.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const content of product.contents) {
      if (existingContentIds.has(content.id)) continue;
      if (occupiedContentSlots.has(`${product.id}\u0000raid\u0000${content.raidId}`)) continue;
      if (occupiedContentSlots.has(`${product.id}\u0000order\u0000${content.sortOrder}`)) continue;
      await orm.ProductRaidContent.create({
        id: content.id,
        productId: product.id,
        raidId: content.raidId,
        sortOrder: content.sortOrder,
        bossCountMode: content.bossCountMode,
        fixedBossCount: content.fixedBossCount,
        minBossCount: content.minBossCount,
        defaultBossCount: content.defaultBossCount,
      });
    }
  }
}

export const raidRepository = {
  ensureReferenceRaids,

  /**
   * The runtime raid catalog (raids, bosses, Blizzard / WCL ids, lockout
   * tracking) — one query (`Raid` with its bosses), historical raids included.
   */
  async loadCatalog(): Promise<RaidCatalog> {
    const rows = (await orm.Raid.include("bosses").all()) as Array<Record<string, unknown>>;
    return buildRaidCatalog(rows.map(mapCatalogRaid));
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
