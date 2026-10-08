import { orm } from "@/lib/prisma";
import { asBoolean, asNumber, asNumberOrNull, asString } from "@/lib/persistence";
import type { ProductBossCountMode, ProductDefinition, ProductRaidContentDefinition } from "@/lib/product-catalog";
import type { PlanningProduct, PlanningProductContent } from "@/lib/product-selection";

function mapBossCountMode(value: unknown): ProductBossCountMode {
  return value === "FIXED" ? "FIXED" : "VARIABLE";
}

function mapContent(row: Record<string, unknown>): ProductRaidContentDefinition {
  return {
    id: asString(row.id),
    raidId: asString(row.raidId),
    sortOrder: asNumber(row.sortOrder, 0),
    bossCountMode: mapBossCountMode(row.bossCountMode),
    fixedBossCount: asNumberOrNull(row.fixedBossCount),
    minBossCount: asNumberOrNull(row.minBossCount),
    defaultBossCount: asNumberOrNull(row.defaultBossCount),
  };
}

function mapProduct(row: Record<string, unknown>): ProductDefinition {
  const contents = Array.isArray(row.contents) ? (row.contents as Array<Record<string, unknown>>) : [];
  return {
    id: asString(row.id),
    key: asString(row.key),
    name: asString(row.name),
    active: asBoolean(row.active, true),
    selectable: asBoolean(row.selectable, true),
    sortOrder: asNumber(row.sortOrder, 0),
    contents: contents.map(mapContent).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

function mapPlanningContent(row: Record<string, unknown>): PlanningProductContent {
  const raid = (row.raid ?? {}) as Record<string, unknown>;
  const bosses = Array.isArray(raid.bosses) ? raid.bosses : [];
  return {
    productRaidContentId: asString(row.id),
    raidId: asString(row.raidId),
    raidName: asString(raid.name, "Unknown raid"),
    sortOrder: asNumber(row.sortOrder, 0),
    bossCountMode: mapBossCountMode(row.bossCountMode),
    fixedBossCount: asNumberOrNull(row.fixedBossCount),
    minBossCount: asNumberOrNull(row.minBossCount),
    defaultBossCount: asNumberOrNull(row.defaultBossCount),
    totalBossCount: bosses.length,
  };
}

function mapPlanningProduct(row: Record<string, unknown>): PlanningProduct {
  const contents = Array.isArray(row.contents) ? (row.contents as Array<Record<string, unknown>>) : [];
  return {
    id: asString(row.id),
    key: asString(row.key),
    name: asString(row.name),
    active: asBoolean(row.active, true),
    selectable: asBoolean(row.selectable, true),
    sortOrder: asNumber(row.sortOrder, 0),
    contents: contents.map(mapPlanningContent).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

function compareProducts(a: Pick<ProductDefinition, "sortOrder" | "key">, b: Pick<ProductDefinition, "sortOrder" | "key">): number {
  return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
}

/**
 * Product catalog readers (database authority). The planning read model
 * (`listPlanningProducts`) feeds every Run / Run Setup product selector.
 */
export const productRepository = {
  /** Every product with its ordered raid contents — one query. */
  async listAll(): Promise<ProductDefinition[]> {
    const rows = (await orm.Product.include("contents").all()) as Array<Record<string, unknown>>;
    return rows.map(mapProduct).sort(compareProducts);
  },

  /** Active + selectable products, in catalog order. */
  async listSelectable(): Promise<ProductDefinition[]> {
    return (await this.listAll()).filter((product) => product.active && product.selectable);
  },

  /**
   * Every product with its ordered contents, each content's raid name and
   * encounter count — the Run planning read model (one bounded query, no
   * per-product lookups). Callers filter by active / selectable.
   */
  async listPlanningProducts(): Promise<PlanningProduct[]> {
    const rows = (await orm.Product.include("contents", (content) =>
      content.include("raid", (raid) => raid.include("bosses", (boss) => boss.select("id"))),
    ).all()) as Array<Record<string, unknown>>;
    return rows.map(mapPlanningProduct).sort(compareProducts);
  },

  async findByKey(key: string): Promise<ProductDefinition | null> {
    const row = (await orm.Product.where({ key }).include("contents").first()) as Record<string, unknown> | null;
    return row ? mapProduct(row) : null;
  },
};
