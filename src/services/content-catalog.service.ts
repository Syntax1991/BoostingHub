import { assertCanManageContentCatalog, type AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { PRODUCT_CATALOG_FIXTURE, type ProductBossCountMode, type ProductDefinition } from "@/lib/product-catalog";
import type { CatalogBoss, CatalogRaid, RaidCatalog } from "@/lib/raid-catalog";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { activityRepository } from "@/repositories/activity.repository";
import {
  contentCatalogRepository,
  EMPTY_RAID_REFERENCES,
  isRaidReferenced,
  type ProductContentWrite,
  type RaidReferenceCounts,
} from "@/repositories/content-catalog.repository";
import { productRepository } from "@/repositories/product.repository";
import { raidRepository } from "@/repositories/raid.repository";
import {
  encounterFieldsSchema,
  type CreateProductInput,
  type EncounterFieldsInput,
  type ProductContentInput,
  type RaidMetadataInput,
  type UpdateProductInput,
  type UpdateRaidInput,
} from "@/validators/content-catalog";

/**
 * Content Catalog administration (/manage/content) — ADMIN / OWNER only.
 *
 * Reads only the persisted DB catalog. The bootstrap fixtures are consulted
 * solely to know which rows are seeded (the insert-only bootstrap would
 * re-create a deleted seed row, so seeded rows are never hard-deleted).
 *
 * Historical safety: a Raid referenced by Runs, Run Setups (contents or the
 * legacy mirror), Products or Character lockouts keeps its encounter structure
 * (count, order, ids) frozen — boss totals and `killedBossIds` depend on it.
 * Identity-preserving metadata (names, season, order, lockout tracking,
 * Blizzard / Warcraft Logs ids) stays editable.
 */

const SEEDED_RAID_IDS = new Set(WOW_RAID_CATALOG.map((raid) => raid.id));
const SEEDED_PRODUCT_IDS = new Set(PRODUCT_CATALOG_FIXTURE.map((product) => product.id));

export type ContentRaidRow = CatalogRaid & {
  references: RaidReferenceCounts;
  referenced: boolean;
  seeded: boolean;
  /** Encounter count / order / membership cannot change (referenced or seeded). */
  structureLocked: boolean;
};

export type ContentProductContentRow = ProductDefinition["contents"][number] & {
  raidName: string;
  raidBossTotal: number;
  /** e.g. "Fixed 1/1" or "Variable 1–8 (default 8)". */
  summary: string;
};

export type ContentProductRow = Omit<ProductDefinition, "contents"> & {
  seeded: boolean;
  contents: ContentProductContentRow[];
};

export type ContentCatalogPage = {
  raids: ContentRaidRow[];
  products: ContentProductRow[];
};

function toRaidRow(raid: CatalogRaid, references: RaidReferenceCounts): ContentRaidRow {
  const referenced = isRaidReferenced(references);
  const seeded = SEEDED_RAID_IDS.has(raid.id);
  return { ...raid, references, referenced, seeded, structureLocked: referenced || seeded };
}

export function summarizeProductContent(
  content: Pick<ProductDefinition["contents"][number], "bossCountMode" | "fixedBossCount" | "minBossCount" | "defaultBossCount">,
  raidBossTotal: number,
): string {
  if (content.bossCountMode === "FIXED") return `Fixed ${content.fixedBossCount ?? "?"}/${raidBossTotal}`;
  return `Variable ${content.minBossCount ?? "?"}–${raidBossTotal} (default ${content.defaultBossCount ?? "?"})`;
}

function toProductRow(product: ProductDefinition, catalog: RaidCatalog): ContentProductRow {
  return {
    ...product,
    seeded: SEEDED_PRODUCT_IDS.has(product.id),
    contents: product.contents.map((content) => {
      const raid = catalog.findById(content.raidId);
      const raidBossTotal = raid?.bosses.length ?? 0;
      return {
        ...content,
        raidName: raid?.name ?? "Unknown raid",
        raidBossTotal,
        summary: summarizeProductContent(content, raidBossTotal),
      };
    }),
  };
}

function referenceSummary(references: RaidReferenceCounts): string {
  const parts = [
    [references.runContents, "Run content"],
    [references.templateContents + references.templates, "Run Setup reference"],
    [references.productContents, "Product content"],
    [references.lockouts, "Character lockout"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`)
    .join(", ");
}

/* ------------------------------------------------------- integration guards */

function assertIntegrationIds(
  catalog: RaidCatalog,
  input: { raidId: string; blizzardInstanceId?: number | null },
): void {
  if (input.blizzardInstanceId == null) return;
  const clash = catalog.raids.find(
    (raid) => raid.id !== input.raidId && raid.blizzardInstanceId === input.blizzardInstanceId,
  );
  if (clash) {
    // Lockout derivation picks the Blizzard raid payload by instance id.
    throw new DomainError(
      "CONTENT_BLIZZARD_INSTANCE_CONFLICT",
      `Blizzard instance ${input.blizzardInstanceId} already belongs to ${clash.name}.`,
    );
  }
}

function assertEncounterIds(
  catalog: RaidCatalog,
  input: { raidId: string; bossId: string | null; blizzardEncounterIds: readonly number[]; wclEncounterIds: readonly number[] },
): void {
  const raid = catalog.findById(input.raidId);
  const siblings = (raid?.bosses ?? []).filter((boss) => boss.id !== input.bossId);
  // Lockout derivation matches a Blizzard encounter to the FIRST boss of the raid holding it.
  for (const id of input.blizzardEncounterIds) {
    const clash = siblings.find((boss) => boss.blizzardEncounterIds.includes(id));
    if (clash) {
      throw new DomainError(
        "CONTENT_BLIZZARD_ENCOUNTER_CONFLICT",
        `Blizzard encounter ${id} is already mapped to ${clash.name} in this raid.`,
      );
    }
  }
  // WCL fight assignment maps an encounter id to exactly one raid; keep it unique per boss.
  for (const id of input.wclEncounterIds) {
    for (const other of catalog.raids) {
      const clash = other.bosses.find((boss) => boss.id !== input.bossId && boss.wclEncounterIds.includes(id));
      if (clash) {
        throw new DomainError(
          "CONTENT_WCL_ENCOUNTER_CONFLICT",
          `Warcraft Logs encounter ${id} is already mapped to ${clash.name} (${other.name}).`,
        );
      }
    }
  }
}

/* ------------------------------------------------------- product validation */

/** Validate + normalize ordered product contents against the DB catalog (max = raid encounter count). */
export function validateProductContents(
  contents: readonly ProductContentInput[],
  catalog: RaidCatalog,
): ProductContentWrite[] {
  if (contents.length === 0) {
    throw new DomainError("CONTENT_PRODUCT_EMPTY", "A product needs at least one raid content.");
  }
  const seen = new Set<string>();
  return contents.map((content) => {
    const raid = catalog.findById(content.raidId);
    if (!raid) throw new DomainError("CONTENT_RAID_NOT_FOUND", "A selected raid no longer exists.", 404);
    if (seen.has(raid.id)) {
      throw new DomainError("CONTENT_DUPLICATE_PRODUCT_RAID", `${raid.name} appears more than once in this product.`);
    }
    seen.add(raid.id);
    const total = raid.bosses.length;
    if (total === 0) {
      throw new DomainError("CONTENT_INVALID_BOSS_COUNT", `${raid.name} has no encounters yet.`);
    }
    const mode: ProductBossCountMode = content.bossCountMode;
    if (mode === "FIXED") {
      const fixed = content.fixedBossCount;
      if (fixed == null || fixed < 1 || fixed > total) {
        throw new DomainError(
          "CONTENT_INVALID_BOSS_COUNT",
          `${raid.name}: fixed boss count must be between 1 and ${total}.`,
        );
      }
      return { raidId: raid.id, bossCountMode: mode, fixedBossCount: fixed, minBossCount: null, defaultBossCount: null };
    }
    const min = content.minBossCount;
    const preset = content.defaultBossCount;
    if (min == null || preset == null || min < 1 || min > preset || preset > total) {
      throw new DomainError(
        "CONTENT_INVALID_BOSS_COUNT",
        `${raid.name}: variable counts need 1 ≤ minimum ≤ default ≤ ${total}.`,
      );
    }
    return { raidId: raid.id, bossCountMode: mode, fixedBossCount: null, minBossCount: min, defaultBossCount: preset };
  });
}

/* --------------------------------------------------------------- loaders */

async function loadRaidContext(raidId: string): Promise<{ catalog: RaidCatalog; raid: CatalogRaid }> {
  const catalog = await raidRepository.loadCatalog();
  const raid = catalog.findById(raidId);
  if (!raid) throw new DomainError("CONTENT_RAID_NOT_FOUND", "Raid was not found.", 404);
  return { catalog, raid };
}

async function loadBossContext(bossId: string): Promise<{ catalog: RaidCatalog; raid: CatalogRaid; boss: CatalogBoss }> {
  const catalog = await raidRepository.loadCatalog();
  for (const raid of catalog.raids) {
    const boss = raid.bosses.find((row) => row.id === bossId);
    if (boss) return { catalog, raid, boss };
  }
  throw new DomainError("CONTENT_ENCOUNTER_NOT_FOUND", "Encounter was not found.", 404);
}

async function assertEncounterStructureEditable(raid: CatalogRaid): Promise<void> {
  if (SEEDED_RAID_IDS.has(raid.id)) {
    throw new DomainError(
      "CONTENT_ENCOUNTER_IN_USE",
      `${raid.name} is core catalog content: its encounters cannot be added, removed or reordered.`,
    );
  }
  const references = await contentCatalogRepository.raidReferenceCounts(raid.id);
  if (isRaidReferenced(references)) {
    throw new DomainError(
      "CONTENT_ENCOUNTER_IN_USE",
      `${raid.name} is in use (${referenceSummary(references)}): its encounters cannot be added, removed or reordered.`,
    );
  }
}

async function loadProduct(productId: string): Promise<ProductDefinition> {
  const product = (await productRepository.listAll()).find((row) => row.id === productId);
  if (!product) throw new DomainError("CONTENT_PRODUCT_NOT_FOUND", "Product was not found.", 404);
  return product;
}

async function record(admin: AuthenticatedUser, type: string, message: string): Promise<void> {
  await activityRepository.create({ userId: admin.id, type, message });
}

/* --------------------------------------------------------------- service */

export const contentCatalogService = {
  /** Raids + encounters (1 query), reference counts (5 grouped counts), products + contents (1 query). */
  async getPage(admin: AuthenticatedUser): Promise<ContentCatalogPage> {
    assertCanManageContentCatalog(admin);
    const [catalog, references, products] = await Promise.all([
      raidRepository.loadCatalog(),
      contentCatalogRepository.listRaidReferenceCounts(),
      productRepository.listAll(),
    ]);
    return {
      raids: catalog.raids.map((raid) => toRaidRow(raid, references.get(raid.id) ?? EMPTY_RAID_REFERENCES)),
      products: products.map((product) => toProductRow(product, catalog)),
    };
  },

  async getRaidDetail(admin: AuthenticatedUser, raidId: string): Promise<ContentRaidRow> {
    assertCanManageContentCatalog(admin);
    const [{ raid }, references] = await Promise.all([
      loadRaidContext(raidId),
      contentCatalogRepository.raidReferenceCounts(raidId),
    ]);
    return toRaidRow(raid, references);
  },

  async createRaid(admin: AuthenticatedUser, input: RaidMetadataInput, now = new Date()): Promise<{ raidId: string }> {
    assertCanManageContentCatalog(admin);
    const catalog = await raidRepository.loadCatalog();
    const raidId = crypto.randomUUID();
    assertIntegrationIds(catalog, { raidId, blizzardInstanceId: input.blizzardInstanceId });
    await contentCatalogRepository.createRaid({ id: raidId, ...input, now: now.toISOString() });
    await record(admin, "CONTENT_RAID_CREATED", `Raid "${input.name}" created.`);
    return { raidId };
  },

  async updateRaid(admin: AuthenticatedUser, input: UpdateRaidInput, now = new Date()): Promise<void> {
    assertCanManageContentCatalog(admin);
    const { catalog, raid } = await loadRaidContext(input.raidId);
    assertIntegrationIds(catalog, { raidId: raid.id, blizzardInstanceId: input.blizzardInstanceId });
    await contentCatalogRepository.updateRaid(raid.id, {
      name: input.name,
      season: input.season,
      isActive: input.availableForRuns,
      sortOrder: input.sortOrder,
      trackLockouts: input.trackLockouts,
      blizzardInstanceId: input.blizzardInstanceId,
      wclZoneId: input.wclZoneId,
      wclRankingEncounterId: input.wclRankingEncounterId,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_RAID_UPDATED", `Raid "${input.name}" updated.`);
  },

  /** Hard delete only for an unreferenced, non-seeded Raid. Otherwise mark it unavailable for new Runs. */
  async deleteRaid(admin: AuthenticatedUser, raidId: string): Promise<{ name: string }> {
    assertCanManageContentCatalog(admin);
    const { raid } = await loadRaidContext(raidId);
    if (SEEDED_RAID_IDS.has(raid.id)) {
      throw new DomainError(
        "CONTENT_RAID_IN_USE",
        `${raid.name} is core catalog content and cannot be deleted. Turn off "Available for new Runs" instead.`,
      );
    }
    const references = await contentCatalogRepository.raidReferenceCounts(raid.id);
    if (isRaidReferenced(references)) {
      throw new DomainError(
        "CONTENT_RAID_IN_USE",
        `${raid.name} is in use (${referenceSummary(references)}) and cannot be deleted. Turn off "Available for new Runs" instead.`,
      );
    }
    await contentCatalogRepository.deleteRaid(raid.id);
    await record(admin, "CONTENT_RAID_DELETED", `Raid "${raid.name}" deleted.`);
    return { name: raid.name };
  },

  async createEncounter(
    admin: AuthenticatedUser,
    input: EncounterFieldsInput & { raidId: string },
  ): Promise<{ bossId: string }> {
    assertCanManageContentCatalog(admin);
    const fields = encounterFieldsSchema.parse(input); // sorted, unique, positive ids
    const { catalog, raid } = await loadRaidContext(input.raidId);
    await assertEncounterStructureEditable(raid);
    assertEncounterIds(catalog, { ...fields, raidId: raid.id, bossId: null });
    const bossId = crypto.randomUUID();
    const nextOrder = raid.bosses.reduce((max, boss) => Math.max(max, boss.sortOrder), 0) + 1;
    await contentCatalogRepository.createEncounter({
      id: bossId,
      raidId: raid.id,
      name: fields.name,
      sortOrder: nextOrder,
      blizzardEncounterIds: fields.blizzardEncounterIds,
      wclEncounterIds: fields.wclEncounterIds,
    });
    await record(admin, "CONTENT_ENCOUNTER_CREATED", `Encounter "${input.name}" added to ${raid.name}.`);
    return { bossId };
  },

  /** Name and integration ids; identity (id, raid, order) is never changed — allowed on referenced raids. */
  async updateEncounter(admin: AuthenticatedUser, input: EncounterFieldsInput & { bossId: string }): Promise<void> {
    assertCanManageContentCatalog(admin);
    const fields = encounterFieldsSchema.parse(input); // sorted, unique, positive ids
    const { catalog, raid, boss } = await loadBossContext(input.bossId);
    assertEncounterIds(catalog, { ...fields, raidId: raid.id, bossId: boss.id });
    await contentCatalogRepository.updateEncounter(boss.id, fields);
    await record(admin, "CONTENT_ENCOUNTER_UPDATED", `Encounter "${input.name}" in ${raid.name} updated.`);
  },

  async moveEncounter(admin: AuthenticatedUser, input: { bossId: string; direction: "UP" | "DOWN" }): Promise<void> {
    assertCanManageContentCatalog(admin);
    const { raid, boss } = await loadBossContext(input.bossId);
    await assertEncounterStructureEditable(raid);
    const ordered = raid.bosses.map((row) => row.id);
    const index = ordered.indexOf(boss.id);
    const target = input.direction === "UP" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await contentCatalogRepository.setEncounterOrder(ordered);
  },

  async deleteEncounter(admin: AuthenticatedUser, bossId: string): Promise<{ name: string }> {
    assertCanManageContentCatalog(admin);
    const { raid, boss } = await loadBossContext(bossId);
    await assertEncounterStructureEditable(raid);
    await contentCatalogRepository.deleteEncounter(
      boss.id,
      raid.bosses.filter((row) => row.id !== boss.id).map((row) => row.id),
    );
    await record(admin, "CONTENT_ENCOUNTER_DELETED", `Encounter "${boss.name}" removed from ${raid.name}.`);
    return { name: boss.name };
  },

  async createProduct(admin: AuthenticatedUser, input: CreateProductInput, now = new Date()): Promise<{ productId: string }> {
    assertCanManageContentCatalog(admin);
    if (await contentCatalogRepository.findProductIdByKey(input.key)) {
      throw new DomainError("CONTENT_PRODUCT_KEY_CONFLICT", `A product with key ${input.key} already exists.`);
    }
    const contents = validateProductContents(input.contents, await raidRepository.loadCatalog());
    const productId = crypto.randomUUID();
    await contentCatalogRepository.createProduct({
      id: productId,
      key: input.key,
      name: input.name,
      active: input.active,
      selectable: input.selectable,
      sortOrder: input.sortOrder,
      contents,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_PRODUCT_CREATED", `Product "${input.name}" (${input.key}) created.`);
    return { productId };
  },

  /** The key is immutable; contents are replaced in order. Runs and Run Setups are never rewritten. */
  async updateProduct(admin: AuthenticatedUser, input: UpdateProductInput, now = new Date()): Promise<void> {
    assertCanManageContentCatalog(admin);
    const product = await loadProduct(input.productId);
    const contents = validateProductContents(input.contents, await raidRepository.loadCatalog());
    await contentCatalogRepository.updateProduct(product.id, {
      name: input.name,
      active: input.active,
      selectable: input.selectable,
      sortOrder: input.sortOrder,
      contents,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_PRODUCT_UPDATED", `Product "${input.name}" (${product.key}) updated.`);
  },

  async setProductActive(admin: AuthenticatedUser, productId: string, active: boolean, now = new Date()) {
    assertCanManageContentCatalog(admin);
    const product = await loadProduct(productId);
    await contentCatalogRepository.setProductFlags(product.id, { active, now: now.toISOString() });
    await record(
      admin,
      active ? "CONTENT_PRODUCT_ACTIVATED" : "CONTENT_PRODUCT_DEACTIVATED",
      `Product "${product.name}" ${active ? "activated" : "deactivated"}.`,
    );
    return { name: product.name };
  },

  async setProductSelectable(admin: AuthenticatedUser, productId: string, selectable: boolean, now = new Date()) {
    assertCanManageContentCatalog(admin);
    const product = await loadProduct(productId);
    await contentCatalogRepository.setProductFlags(product.id, { selectable, now: now.toISOString() });
    await record(
      admin,
      "CONTENT_PRODUCT_UPDATED",
      `Product "${product.name}" ${selectable ? "shown in" : "hidden from"} selection.`,
    );
    return { name: product.name };
  },

  /** Seeded products are never hard-deleted (the bootstrap would re-create them) — deactivate them instead. */
  async deleteProduct(admin: AuthenticatedUser, productId: string): Promise<{ name: string }> {
    assertCanManageContentCatalog(admin);
    const product = await loadProduct(productId);
    if (SEEDED_PRODUCT_IDS.has(product.id)) {
      throw new DomainError(
        "CONTENT_PRODUCT_IN_USE",
        `${product.name} is core catalog content and cannot be deleted. Deactivate it instead.`,
      );
    }
    await contentCatalogRepository.deleteProduct(product.id);
    await record(admin, "CONTENT_PRODUCT_DELETED", `Product "${product.name}" (${product.key}) deleted.`);
    return { name: product.name };
  },
};
