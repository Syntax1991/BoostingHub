import { db, orm } from "@/lib/prisma";
import { asNumber, asString } from "@/lib/persistence";
import type { ProductBossCountMode } from "@/lib/product-catalog";
import { serializeEncounterIds } from "@/lib/raid-catalog";

/**
 * Write-side + reference reads for the Raid Catalog admin (/manage/raid-catalog).
 * Catalog reads (raids + bosses, products + contents) stay on raidRepository /
 * productRepository so the admin sees exactly what the runtime reads.
 */

/** Every authority that may reference a Raid. Any non-zero count makes the Raid "in use". */
export type RaidReferenceCounts = {
  runContents: number;
  templateContents: number;
  /** Legacy singular `RunTemplate.raidId` mirror. */
  templates: number;
  productContents: number;
  lockouts: number;
};

export const EMPTY_RAID_REFERENCES: RaidReferenceCounts = {
  runContents: 0,
  templateContents: 0,
  templates: 0,
  productContents: 0,
  lockouts: 0,
};

export function isRaidReferenced(counts: RaidReferenceCounts): boolean {
  return Object.values(counts).some((count) => count > 0);
}

type TxOrm = typeof orm;

function txOrmOf(tx: { orm: unknown }): TxOrm {
  return ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
}

type GroupedCount = { raidId: unknown; count: unknown };

function toCountMap(rows: readonly GroupedCount[]): Map<string, number> {
  return new Map(rows.map((row) => [asString(row.raidId), asNumber(row.count, 0)]));
}

export type ProductContentWrite = {
  raidId: string;
  bossCountMode: ProductBossCountMode;
  fixedBossCount: number | null;
  minBossCount: number | null;
  defaultBossCount: number | null;
};

export type ProductWrite = {
  name: string;
  active: boolean;
  selectable: boolean;
  sortOrder: number;
  contents: readonly ProductContentWrite[];
};

/** Replace a product's ordered contents in place: keeps row ids per raid, never touches Runs/templates. */
async function writeProductContents(txOrm: TxOrm, productId: string, contents: readonly ProductContentWrite[]) {
  const existing = (await txOrm.ProductRaidContent.where({ productId }).all()) as Array<Record<string, unknown>>;
  const byRaid = new Map(existing.map((row) => [asString(row.raidId), asString(row.id)]));
  const keepRaidIds = new Set(contents.map((content) => content.raidId));
  for (const row of existing) {
    if (!keepRaidIds.has(asString(row.raidId))) {
      await txOrm.ProductRaidContent.where({ id: asString(row.id) }).delete();
    }
  }
  // Park kept rows on negative orders first so the (productId, sortOrder) unique never collides mid-reorder.
  let parked = 0;
  for (const content of contents) {
    const id = byRaid.get(content.raidId);
    if (id) {
      parked -= 1;
      await txOrm.ProductRaidContent.where({ id }).update({ sortOrder: parked });
    }
  }
  for (const [index, content] of contents.entries()) {
    const values = {
      sortOrder: index + 1,
      bossCountMode: content.bossCountMode,
      fixedBossCount: content.fixedBossCount,
      minBossCount: content.minBossCount,
      defaultBossCount: content.defaultBossCount,
    };
    const id = byRaid.get(content.raidId);
    if (id) {
      await txOrm.ProductRaidContent.where({ id }).update(values);
    } else {
      await txOrm.ProductRaidContent.create({ id: crypto.randomUUID(), productId, raidId: content.raidId, ...values });
    }
  }
}

export const raidCatalogRepository = {
  /** Distinct non-empty `Raid.season` values for the Season selector (newest / lexical order). */
  async listDistinctSeasons(): Promise<string[]> {
    const rows = (await orm.Raid.select("season").all()) as Array<{ season: unknown }>;
    const seen = new Set<string>();
    for (const row of rows) {
      const season = asString(row.season).trim();
      if (season) seen.add(season);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  },

  /** Reference counts for every Raid — five grouped COUNT queries, independent of row counts. */
  async listRaidReferenceCounts(): Promise<Map<string, RaidReferenceCounts>> {
    const [runContents, templateContents, templates, productContents, lockouts] = await Promise.all([
      orm.RunRaidContent.groupBy("raidId").aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.RunTemplateRaidContent.groupBy("raidId").aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.RunTemplate.groupBy("raidId").aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.ProductRaidContent.groupBy("raidId").aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.CharacterRaidLockout.groupBy("raidId").aggregate((aggregate) => ({ count: aggregate.count() })),
    ]);
    const maps = {
      runContents: toCountMap(runContents as GroupedCount[]),
      templateContents: toCountMap(templateContents as GroupedCount[]),
      templates: toCountMap(templates as GroupedCount[]),
      productContents: toCountMap(productContents as GroupedCount[]),
      lockouts: toCountMap(lockouts as GroupedCount[]),
    };
    const raidIds = new Set(Object.values(maps).flatMap((map) => [...map.keys()]));
    return new Map(
      [...raidIds].map((raidId) => [
        raidId,
        {
          runContents: maps.runContents.get(raidId) ?? 0,
          templateContents: maps.templateContents.get(raidId) ?? 0,
          templates: maps.templates.get(raidId) ?? 0,
          productContents: maps.productContents.get(raidId) ?? 0,
          lockouts: maps.lockouts.get(raidId) ?? 0,
        },
      ]),
    );
  },

  /** Authoritative server-side reference check for one Raid (guards deletes / encounter structure). */
  async raidReferenceCounts(raidId: string): Promise<RaidReferenceCounts> {
    const [runContents, templateContents, templates, productContents, lockouts] = await Promise.all([
      orm.RunRaidContent.where({ raidId }).aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.RunTemplateRaidContent.where({ raidId }).aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.RunTemplate.where({ raidId }).aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.ProductRaidContent.where({ raidId }).aggregate((aggregate) => ({ count: aggregate.count() })),
      orm.CharacterRaidLockout.where({ raidId }).aggregate((aggregate) => ({ count: aggregate.count() })),
    ]);
    const value = (row: unknown) => asNumber((row as { count?: unknown }).count, 0);
    return {
      runContents: value(runContents),
      templateContents: value(templateContents),
      templates: value(templates),
      productContents: value(productContents),
      lockouts: value(lockouts),
    };
  },

  async createRaid(input: {
    id: string;
    name: string;
    season: string;
    sortOrder: number;
    trackLockouts: boolean;
    blizzardInstanceId: number | null;
    wclZoneId: number | null;
    wclRankingEncounterId: number | null;
    now: string;
  }): Promise<void> {
    await orm.Raid.create({
      id: input.id,
      name: input.name,
      season: input.season,
      // A new Raid is not offered for new Runs until an admin enables it.
      isActive: false,
      sortOrder: input.sortOrder,
      trackLockouts: input.trackLockouts,
      blizzardInstanceId: input.blizzardInstanceId,
      wclZoneId: input.wclZoneId,
      wclRankingEncounterId: input.wclRankingEncounterId,
      createdAt: input.now,
      updatedAt: input.now,
    });
  },

  async updateRaid(
    raidId: string,
    input: {
      name: string;
      season: string;
      isActive: boolean;
      sortOrder: number;
      trackLockouts: boolean;
      blizzardInstanceId: number | null;
      now: string;
    },
  ): Promise<void> {
    const { now, ...values } = input;
    await orm.Raid.where({ id: raidId }).update({ ...values, updatedAt: now });
  },

  /** Persist Warcraft Logs raid-level mapping (or clear with nulls). Does not touch Blizzard ids. */
  async updateRaidWclMapping(
    raidId: string,
    input: { wclZoneId: number | null; wclRankingEncounterId: number | null; now: string },
  ): Promise<void> {
    await orm.Raid.where({ id: raidId }).update({
      wclZoneId: input.wclZoneId,
      wclRankingEncounterId: input.wclRankingEncounterId,
      updatedAt: input.now,
    });
  },

  /** Hard delete — callers must have proven the Raid unreferenced. Its RaidBoss rows go with it. */
  async deleteRaid(raidId: string): Promise<void> {
    await orm.Raid.where({ id: raidId }).delete();
  },

  async createEncounter(input: {
    id: string;
    raidId: string;
    name: string;
    sortOrder: number;
    blizzardEncounterIds: readonly number[];
    wclEncounterIds: readonly number[];
  }): Promise<void> {
    await orm.RaidBoss.create({
      id: input.id,
      raidId: input.raidId,
      name: input.name,
      sortOrder: input.sortOrder,
      blizzardEncounterIds: serializeEncounterIds(input.blizzardEncounterIds),
      wclEncounterIds: serializeEncounterIds(input.wclEncounterIds),
    });
  },

  /** Identity-preserving edit: id, raidId and sortOrder are never written here. */
  async updateEncounter(
    bossId: string,
    input: { name: string; blizzardEncounterIds: readonly number[]; wclEncounterIds: readonly number[] },
  ): Promise<void> {
    await orm.RaidBoss.where({ id: bossId }).update({
      name: input.name,
      blizzardEncounterIds: serializeEncounterIds(input.blizzardEncounterIds),
      wclEncounterIds: serializeEncounterIds(input.wclEncounterIds),
    });
  },

  /** Rewrite one raid's encounter order (ids unchanged). */
  async setEncounterOrder(orderedBossIds: readonly string[]): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      for (const [index, id] of orderedBossIds.entries()) {
        await txOrm.RaidBoss.where({ id }).update({ sortOrder: index + 1 });
      }
    });
  },

  async deleteEncounter(bossId: string, remainingOrderedBossIds: readonly string[]): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      await txOrm.RaidBoss.where({ id: bossId }).delete();
      for (const [index, id] of remainingOrderedBossIds.entries()) {
        await txOrm.RaidBoss.where({ id }).update({ sortOrder: index + 1 });
      }
    });
  },

  async findProductIdByKey(key: string): Promise<string | null> {
    const row = (await orm.Product.where({ key }).select("id").first()) as Record<string, unknown> | null;
    return row ? asString(row.id) : null;
  },

  async createProduct(input: ProductWrite & { id: string; key: string; now: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      await txOrm.Product.create({
        id: input.id,
        key: input.key,
        name: input.name,
        active: input.active,
        selectable: input.selectable,
        sortOrder: input.sortOrder,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await writeProductContents(txOrm, input.id, input.contents);
    });
  },

  /** Updates catalog rows only — RunRaidContent / RunTemplateRaidContent are never touched. */
  async updateProduct(productId: string, input: ProductWrite & { now: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      await txOrm.Product.where({ id: productId }).update({
        name: input.name,
        active: input.active,
        selectable: input.selectable,
        sortOrder: input.sortOrder,
        updatedAt: input.now,
      });
      await writeProductContents(txOrm, productId, input.contents);
    });
  },

  async setProductFlags(productId: string, input: { active?: boolean; selectable?: boolean; now: string }) {
    const { now, ...flags } = input;
    await orm.Product.where({ id: productId }).update({ ...flags, updatedAt: now });
  },

  /** Hard delete (contents cascade). Runs and templates never store a productId. */
  async deleteProduct(productId: string): Promise<void> {
    await orm.Product.where({ id: productId }).delete();
  },
};
