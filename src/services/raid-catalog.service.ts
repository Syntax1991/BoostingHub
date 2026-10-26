import { assertCanManageRaidCatalog, type AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { allocateUniqueProductKey } from "@/lib/product-key";
import { PRODUCT_CATALOG_FIXTURE, type ProductBossCountMode, type ProductDefinition } from "@/lib/product-catalog";
import {
  raidIntegrationStatus,
  type CatalogBoss,
  type CatalogRaid,
  type RaidCatalog,
  type RaidIntegrationStatus,
} from "@/lib/raid-catalog";
import { RAID_SEASONS } from "@/lib/raid-seasons";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { activityRepository } from "@/repositories/activity.repository";
import {
  raidCatalogRepository,
  EMPTY_RAID_REFERENCES,
  isRaidReferenced,
  type ProductContentWrite,
  type RaidReferenceCounts,
} from "@/repositories/raid-catalog.repository";
import { productRepository } from "@/repositories/product.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { discoverBlizzardRaidMetadata } from "@/services/blizzard-raid-metadata.service";
import {
  discoverWarcraftLogsRaidMetadata,
  type DiscoverRaidMetadataOptions,
} from "@/services/warcraft-logs-raid-metadata.service";
import {
  encounterAdminFieldsSchema,
  type CreateProductInput,
  type EncounterAdminFieldsInput,
  type ProductContentInput,
  type RaidMetadataInput,
  type UpdateProductInput,
  type UpdateRaidInput,
} from "@/validators/raid-catalog";

/**
 * Raid Catalog administration (/manage/raid-catalog) — ADMIN / OWNER only.
 *
 * Reads only the persisted DB catalog. The bootstrap fixtures are consulted
 * solely to know which rows are seeded (the insert-only bootstrap would
 * re-create a deleted seed row, so seeded rows are never hard-deleted).
 *
 * Historical safety: a Raid referenced by Runs, Run Setups (contents),
 * Products or Character lockouts keeps its encounter structure
 * (count, order, ids) frozen — boss totals and `killedBossIds` depend on it.
 * Identity-preserving metadata (names, season, order, lockout tracking,
 * Blizzard / Warcraft Logs ids) stays editable.
 *
 * Raid lifecycle (one action per state, decided before rendering):
 * - unused, non-seeded → Delete (hard delete, bosses go with it);
 * - a duplicate of another Raid with the same Blizzard instance, used by no
 *   Run / Run Setup / Product → Remove duplicate (its lockouts fold into the
 *   other Raid, then it is deleted);
 * - otherwise (referenced or seeded) → Archive (`Raid.archivedAt`): kept for
 *   history, lockouts and Warcraft Logs, closed to new Runs / Run Setups /
 *   Product contents; Restore clears it.
 */

const SEEDED_RAID_IDS = new Set(WOW_RAID_CATALOG.map((raid) => raid.id));
const SEEDED_PRODUCT_IDS = new Set(PRODUCT_CATALOG_FIXTURE.map((product) => product.id));

export type RaidCatalogRaidRow = CatalogRaid & {
  references: RaidReferenceCounts;
  referenced: boolean;
  seeded: boolean;
  /** Encounter count / order / membership cannot change (referenced or seeded). */
  structureLocked: boolean;
  /** Blizzard / boss mapping / lockout / Warcraft Logs readiness (derived). */
  status: RaidIntegrationStatus;
  archived: boolean;
  /** The Raid this row duplicates (same Blizzard instance) and can be folded into. */
  duplicateOf: { id: string; name: string } | null;
  /** Lifecycle actions the server accepts for this Raid right now. */
  actions: RaidLifecycleActions;
};

export type RaidLifecycleActions = {
  delete: boolean;
  removeDuplicate: boolean;
  archive: boolean;
  restore: boolean;
};

export type RaidCatalogProductContentRow = ProductDefinition["contents"][number] & {
  raidName: string;
  raidBossTotal: number;
  /** e.g. "Fixed 1/1" or "Variable 1–8 (default 8)". */
  summary: string;
};

export type RaidCatalogProductRow = Omit<ProductDefinition, "contents"> & {
  seeded: boolean;
  contents: RaidCatalogProductContentRow[];
};

export type RaidCatalogPageData = {
  raids: RaidCatalogRaidRow[];
  products: RaidCatalogProductRow[];
  /** Distinct persisted seasons for the Season selector (no hardcoded list). */
  seasons: string[];
  /** Code-defined Blizzard import seasons (`RAID_SEASONS`), newest first. */
  importSeasons: Array<{ key: string; name: string; current: boolean; raidCount: number }>;
};

type ReferenceLookup = (raidId: string) => RaidReferenceCounts;

function referenceLookup(map: ReadonlyMap<string, RaidReferenceCounts>): ReferenceLookup {
  return (raidId) => map.get(raidId) ?? EMPTY_RAID_REFERENCES;
}

function planningReferenceCount(references: RaidReferenceCounts): number {
  return references.runContents + references.templateContents + references.productContents;
}

/** Which Raid of a same-instance group is kept: planning references, then lockouts, then id. */
function outranks(a: CatalogRaid, b: CatalogRaid, referencesOf: ReferenceLookup): boolean {
  const ra = referencesOf(a.id);
  const rb = referencesOf(b.id);
  const byPlanning = planningReferenceCount(ra) - planningReferenceCount(rb);
  if (byPlanning !== 0) return byPlanning > 0;
  const byLockouts = ra.lockouts - rb.lockouts;
  if (byLockouts !== 0) return byLockouts > 0;
  return a.id < b.id;
}

/**
 * The Raid `raid` duplicates: another Raid with the same Blizzard instance id
 * that outranks it. Only a Raid without Run / Run Setup / Product references
 * is a removable duplicate — those references are never re-pointed.
 */
export function findDuplicateTarget(
  raid: CatalogRaid,
  catalog: RaidCatalog,
  referencesOf: ReferenceLookup,
): CatalogRaid | null {
  if (raid.blizzardInstanceId == null) return null;
  if (planningReferenceCount(referencesOf(raid.id)) > 0) return null;
  let target: CatalogRaid | null = null;
  for (const other of catalog.raids) {
    if (other.id === raid.id || other.blizzardInstanceId !== raid.blizzardInstanceId) continue;
    if (!outranks(other, raid, referencesOf)) continue;
    if (!target || outranks(other, target, referencesOf)) target = other;
  }
  return target;
}

function toRaidRow(raid: CatalogRaid, catalog: RaidCatalog, referencesOf: ReferenceLookup): RaidCatalogRaidRow {
  const references = referencesOf(raid.id);
  const referenced = isRaidReferenced(references);
  const seeded = SEEDED_RAID_IDS.has(raid.id);
  const archived = raid.archivedAt != null;
  const duplicate = findDuplicateTarget(raid, catalog, referencesOf);
  const canDelete = !referenced && !seeded && !duplicate;
  return {
    ...raid,
    references,
    referenced,
    seeded,
    structureLocked: referenced || seeded,
    status: raidIntegrationStatus(raid),
    archived,
    duplicateOf: duplicate ? { id: duplicate.id, name: duplicate.name } : null,
    actions: {
      delete: canDelete,
      removeDuplicate: duplicate != null,
      archive: !archived && !canDelete && !duplicate,
      restore: archived,
    },
  };
}

/** Map each boss of `source` to the `target` boss sharing a Blizzard encounter id, else the same order. */
function duplicateBossMap(source: CatalogRaid, target: CatalogRaid): Map<string, string> {
  const map = new Map<string, string>();
  for (const boss of source.bosses) {
    const match =
      target.bosses.find((candidate) =>
        candidate.blizzardEncounterIds.some((id) => boss.blizzardEncounterIds.includes(id)),
      ) ?? target.bosses.find((candidate) => candidate.sortOrder === boss.sortOrder);
    if (match) map.set(boss.id, match.id);
  }
  return map;
}

export function summarizeProductContent(
  content: Pick<ProductDefinition["contents"][number], "bossCountMode" | "fixedBossCount" | "minBossCount" | "defaultBossCount">,
  raidBossTotal: number,
): string {
  if (content.bossCountMode === "FIXED") return `Fixed ${content.fixedBossCount ?? "?"}/${raidBossTotal}`;
  return `Variable ${content.minBossCount ?? "?"}–${raidBossTotal} (default ${content.defaultBossCount ?? "?"})`;
}

function toProductRow(product: ProductDefinition, catalog: RaidCatalog): RaidCatalogProductRow {
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
    [references.templateContents, "Run Setup reference"],
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
  /** Raids the product already holds — an archived one may stay, never be newly added. */
  keptRaidIds: ReadonlySet<string> = new Set(),
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
    if (raid.archivedAt != null && !keptRaidIds.has(raid.id)) {
      throw new DomainError("CONTENT_RAID_ARCHIVED", `${raid.name} is archived and cannot be added to a product.`);
    }
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
  const references = await raidCatalogRepository.raidReferenceCounts(raid.id);
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

/**
 * Apply WCL discovery patches. Never throws — catalog writes already succeeded.
 * Soft discovery fills only empty fields; `force` overwrites (Retry detection).
 */
export async function applyWclDiscovery(
  raidId: string,
  options: DiscoverRaidMetadataOptions = {},
  now = new Date(),
): Promise<void> {
  try {
    const { raid } = await loadRaidContext(raidId);
    const result = await discoverWarcraftLogsRaidMetadata(raid, options);
    if (result.raidPatch) {
      await raidCatalogRepository.updateRaidWclMapping(raid.id, {
        ...result.raidPatch,
        now: now.toISOString(),
      });
    }
    for (const patch of result.encounterPatches) {
      const boss = raid.bosses.find((row) => row.id === patch.bossId);
      if (!boss) continue;
      // Blizzard ids come from the Blizzard journal (applyBlizzardDiscovery), never from WCL.
      const blizzardEncounterIds = [...boss.blizzardEncounterIds];
      const wclEncounterIds =
        options.force || boss.wclEncounterIds.length === 0
          ? [...patch.wclEncounterIds]
          : [...boss.wclEncounterIds];
      const sameWcl =
        wclEncounterIds.length === boss.wclEncounterIds.length &&
        wclEncounterIds.every((id, index) => id === boss.wclEncounterIds[index]);
      const sameBlizzard =
        blizzardEncounterIds.length === boss.blizzardEncounterIds.length &&
        blizzardEncounterIds.every((id, index) => id === boss.blizzardEncounterIds[index]);
      if (sameWcl && sameBlizzard) continue;
      // Skip if another boss already owns a WCL id we're about to write.
      const catalog = await raidRepository.loadCatalog();
      try {
        assertEncounterIds(catalog, {
          raidId: raid.id,
          bossId: boss.id,
          blizzardEncounterIds,
          wclEncounterIds,
        });
      } catch {
        continue;
      }
      await raidCatalogRepository.updateEncounter(boss.id, {
        name: boss.name,
        blizzardEncounterIds,
        wclEncounterIds,
      });
    }
  } catch (error) {
    console.error("[raid-catalog] WCL discovery failed", { raidId }, error);
  }
}

/**
 * Apply Blizzard journal discovery (instance id + boss encounter ids). Never
 * throws — catalog writes already succeeded. Soft discovery fills only empty
 * fields; `force` (Retry detection) overwrites them with Blizzard's ids.
 */
async function applyBlizzardDiscovery(
  raidId: string,
  options: { force?: boolean } = {},
  now = new Date(),
): Promise<void> {
  try {
    const { raid } = await loadRaidContext(raidId);
    const result = await discoverBlizzardRaidMetadata(raid);
    if (result.status !== "RESOLVED") return;
    const force = options.force === true;

    const writeInstance =
      raid.blizzardInstanceId !== result.blizzardInstanceId && (raid.blizzardInstanceId == null || force);
    if (writeInstance) {
      try {
        assertIntegrationIds(await raidRepository.loadCatalog(), {
          raidId: raid.id,
          blizzardInstanceId: result.blizzardInstanceId,
        });
        await raidCatalogRepository.updateRaidBlizzardInstance(raid.id, {
          blizzardInstanceId: result.blizzardInstanceId,
          now: now.toISOString(),
        });
      } catch {
        // Another raid owns this instance id — leave both alone.
      }
    }

    for (const mapping of result.encounterMappings) {
      const boss = raid.bosses.find((row) => row.id === mapping.bossId);
      if (!boss) continue;
      const same =
        boss.blizzardEncounterIds.length === mapping.blizzardEncounterIds.length &&
        boss.blizzardEncounterIds.every((id, index) => id === mapping.blizzardEncounterIds[index]);
      if (same || (boss.blizzardEncounterIds.length > 0 && !force)) continue;
      try {
        assertEncounterIds(await raidRepository.loadCatalog(), {
          raidId: raid.id,
          bossId: boss.id,
          blizzardEncounterIds: mapping.blizzardEncounterIds,
          wclEncounterIds: boss.wclEncounterIds,
        });
      } catch {
        continue;
      }
      await raidCatalogRepository.updateEncounter(boss.id, {
        name: boss.name,
        blizzardEncounterIds: mapping.blizzardEncounterIds,
        wclEncounterIds: [...boss.wclEncounterIds],
      });
    }
  } catch (error) {
    console.error("[raid-catalog] Blizzard discovery failed", { raidId }, error);
  }
}

/** WCL + Blizzard discovery; each step tolerates the other's outage. */
async function applyDiscovery(raidId: string, options: DiscoverRaidMetadataOptions = {}, now = new Date()) {
  await applyWclDiscovery(raidId, options, now);
  await applyBlizzardDiscovery(raidId, { force: options.force }, now);
}

/* --------------------------------------------------------------- service */

export const raidCatalogService = {
  /** Raids + encounters (1 query), reference counts (5 grouped counts), products + contents (1 query). */
  async getPage(admin: AuthenticatedUser): Promise<RaidCatalogPageData> {
    assertCanManageRaidCatalog(admin);
    const [catalog, references, products, seasons] = await Promise.all([
      raidRepository.loadCatalog(),
      raidCatalogRepository.listRaidReferenceCounts(),
      productRepository.listAll(),
      raidCatalogRepository.listDistinctSeasons(),
    ]);
    const referencesOf = referenceLookup(references);
    return {
      raids: catalog.raids.map((raid) => toRaidRow(raid, catalog, referencesOf)),
      products: products.map((product) => toProductRow(product, catalog)),
      seasons,
      importSeasons: RAID_SEASONS.map((season) => ({
        key: season.key,
        name: season.name,
        current: season.current,
        raidCount: season.journalInstanceIds.length,
      })),
    };
  },

  async listSeasons(admin: AuthenticatedUser): Promise<string[]> {
    assertCanManageRaidCatalog(admin);
    return raidCatalogRepository.listDistinctSeasons();
  },

  async getRaidDetail(admin: AuthenticatedUser, raidId: string): Promise<RaidCatalogRaidRow> {
    assertCanManageRaidCatalog(admin);
    // Grouped counts for every Raid: a duplicate is judged against its same-instance siblings.
    const [{ catalog, raid }, references] = await Promise.all([
      loadRaidContext(raidId),
      raidCatalogRepository.listRaidReferenceCounts(),
    ]);
    return toRaidRow(raid, catalog, referenceLookup(references));
  },

  async createRaid(admin: AuthenticatedUser, input: RaidMetadataInput, now = new Date()): Promise<{ raidId: string }> {
    assertCanManageRaidCatalog(admin);
    const catalog = await raidRepository.loadCatalog();
    const raidId = crypto.randomUUID();
    assertIntegrationIds(catalog, { raidId, blizzardInstanceId: input.blizzardInstanceId });
    await raidCatalogRepository.createRaid({
      id: raidId,
      name: input.name,
      season: input.season,
      sortOrder: input.sortOrder,
      trackLockouts: input.trackLockouts,
      blizzardInstanceId: input.blizzardInstanceId,
      wclZoneId: null,
      wclRankingEncounterId: null,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_RAID_CREATED", `Raid "${input.name}" created.`);
    // Soft discovery — never fails the create.
    await applyDiscovery(raidId, {}, now);
    return { raidId };
  },

  async updateRaid(admin: AuthenticatedUser, input: UpdateRaidInput, now = new Date()): Promise<void> {
    assertCanManageRaidCatalog(admin);
    const { catalog, raid } = await loadRaidContext(input.raidId);
    assertIntegrationIds(catalog, { raidId: raid.id, blizzardInstanceId: input.blizzardInstanceId });
    const nameChanged = raid.name !== input.name;
    await raidCatalogRepository.updateRaid(raid.id, {
      name: input.name,
      season: input.season,
      isActive: input.availableForRuns,
      sortOrder: input.sortOrder,
      // Omitted by older clients → keep the stored short name.
      shortName: input.shortName === undefined ? raid.shortName : input.shortName,
      trackLockouts: input.trackLockouts,
      blizzardInstanceId: input.blizzardInstanceId,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_RAID_UPDATED", `Raid "${input.name}" updated.`);
    // Soft re-discovery when the match key may have changed; never erases existing mappings.
    if (nameChanged || raid.wclZoneId == null) {
      await applyDiscovery(raid.id, {}, now);
    }
  },

  /**
   * Explicit Retry detection — may overwrite prior WCL raid/encounter mappings,
   * and replaces the Blizzard instance / encounter ids with the Blizzard journal's.
   */
  async retryWclDetection(admin: AuthenticatedUser, raidId: string, now = new Date()): Promise<{ resolved: boolean }> {
    assertCanManageRaidCatalog(admin);
    await loadRaidContext(raidId);
    await applyDiscovery(raidId, { force: true }, now);
    const { raid } = await loadRaidContext(raidId);
    await record(admin, "CONTENT_RAID_WCL_RETRY", `Warcraft Logs + Blizzard detection retried for "${raid.name}".`);
    return { resolved: raid.wclZoneId != null };
  },

  /** Clear raid-level WCL mapping (zone + ranking encounter). Encounter boss ids are left alone. */
  async clearWclMapping(admin: AuthenticatedUser, raidId: string, now = new Date()): Promise<void> {
    assertCanManageRaidCatalog(admin);
    const { raid } = await loadRaidContext(raidId);
    await raidCatalogRepository.updateRaidWclMapping(raid.id, {
      wclZoneId: null,
      wclRankingEncounterId: null,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_RAID_WCL_CLEARED", `Warcraft Logs mapping cleared for "${raid.name}".`);
  },

  /** Hard delete only for an unreferenced, non-seeded Raid. Otherwise mark it unavailable for new Runs. */
  async deleteRaid(admin: AuthenticatedUser, raidId: string): Promise<{ name: string }> {
    assertCanManageRaidCatalog(admin);
    const { raid } = await loadRaidContext(raidId);
    if (SEEDED_RAID_IDS.has(raid.id)) {
      throw new DomainError(
        "CONTENT_RAID_IN_USE",
        `${raid.name} is core catalog content and cannot be deleted. Archive it instead.`,
      );
    }
    const references = await raidCatalogRepository.raidReferenceCounts(raid.id);
    if (isRaidReferenced(references)) {
      throw new DomainError(
        "CONTENT_RAID_IN_USE",
        `${raid.name} is in use (${referenceSummary(references)}) and cannot be deleted. Archive it instead.`,
      );
    }
    await raidCatalogRepository.deleteRaid(raid.id);
    await record(admin, "CONTENT_RAID_DELETED", `Raid "${raid.name}" deleted.`);
    return { name: raid.name };
  },

  /** Archive: history, lockouts and Warcraft Logs stay intact; new Runs / Run Setups / Products can no longer use it. */
  async archiveRaid(admin: AuthenticatedUser, raidId: string, now = new Date()): Promise<{ name: string }> {
    assertCanManageRaidCatalog(admin);
    const { raid } = await loadRaidContext(raidId);
    if (raid.archivedAt != null) {
      throw new DomainError("CONTENT_RAID_ARCHIVED", `${raid.name} is already archived.`);
    }
    await raidCatalogRepository.setRaidArchivedAt(raid.id, { archivedAt: now.toISOString(), now: now.toISOString() });
    await record(admin, "CONTENT_RAID_ARCHIVED", `Raid "${raid.name}" archived.`);
    return { name: raid.name };
  },

  async restoreRaid(admin: AuthenticatedUser, raidId: string, now = new Date()): Promise<{ name: string }> {
    assertCanManageRaidCatalog(admin);
    const { raid } = await loadRaidContext(raidId);
    if (raid.archivedAt == null) {
      throw new DomainError("CONTENT_RAID_NOT_ARCHIVED", `${raid.name} is not archived.`);
    }
    await raidCatalogRepository.setRaidArchivedAt(raid.id, { archivedAt: null, now: now.toISOString() });
    await record(admin, "CONTENT_RAID_RESTORED", `Raid "${raid.name}" restored.`);
    return { name: raid.name };
  },

  /**
   * Remove a duplicate Raid (same Blizzard instance as a Raid that outranks it):
   * its Character lockouts fold into that Raid (exact copies dropped), then it is
   * deleted. Refused when the duplicate is used by a Run, Run Setup or Product.
   */
  async removeDuplicateRaid(
    admin: AuthenticatedUser,
    raidId: string,
    now = new Date(),
  ): Promise<{ name: string; keptRaidName: string; droppedLockouts: number; movedLockouts: number }> {
    assertCanManageRaidCatalog(admin);
    const [{ catalog, raid }, references] = await Promise.all([
      loadRaidContext(raidId),
      raidCatalogRepository.listRaidReferenceCounts(),
    ]);
    const target = findDuplicateTarget(raid, catalog, referenceLookup(references));
    if (!target) {
      throw new DomainError(
        "CONTENT_RAID_NOT_DUPLICATE",
        `${raid.name} is not a removable duplicate: no other raid shares its Blizzard instance, or it is used by a Run, Run Setup or Product.`,
      );
    }
    const result = await raidCatalogRepository.mergeDuplicateRaid({
      sourceRaidId: raid.id,
      targetRaidId: target.id,
      bossIdMap: duplicateBossMap(raid, target),
      now: now.toISOString(),
    });
    await record(
      admin,
      "CONTENT_RAID_DUPLICATE_REMOVED",
      `Duplicate raid "${raid.name}" (${raid.id}) folded into ${target.id}: ${result.droppedLockouts} duplicate lockouts dropped, ${result.movedLockouts} moved.`,
    );
    return { name: raid.name, keptRaidName: target.name, ...result };
  },

  async createEncounter(
    admin: AuthenticatedUser,
    input: EncounterAdminFieldsInput & { raidId: string; /** Test / recovery only — never from admin create schema. */ wclEncounterIds?: readonly number[] },
  ): Promise<{ bossId: string }> {
    assertCanManageRaidCatalog(admin);
    const fields = encounterAdminFieldsSchema.parse(input); // sorted, unique, positive blizzard ids
    const wclEncounterIds = [...(input.wclEncounterIds ?? [])].sort((a, b) => a - b);
    const { catalog, raid } = await loadRaidContext(input.raidId);
    await assertEncounterStructureEditable(raid);
    assertEncounterIds(catalog, {
      raidId: raid.id,
      bossId: null,
      blizzardEncounterIds: fields.blizzardEncounterIds,
      wclEncounterIds,
    });
    const bossId = crypto.randomUUID();
    const nextOrder = raid.bosses.reduce((max, boss) => Math.max(max, boss.sortOrder), 0) + 1;
    await raidCatalogRepository.createEncounter({
      id: bossId,
      raidId: raid.id,
      name: fields.name,
      sortOrder: nextOrder,
      blizzardEncounterIds: fields.blizzardEncounterIds,
      wclEncounterIds,
    });
    await record(admin, "CONTENT_ENCOUNTER_CREATED", `Encounter "${input.name}" added to ${raid.name}.`);
    if (wclEncounterIds.length === 0) await applyDiscovery(raid.id);
    return { bossId };
  },

  /**
   * Name and Blizzard ids from the admin form. Optional `wclEncounterIds` is for tests /
   * recovery only — the Raid Catalog UI never submits it (discovery fills empty ids).
   */
  async updateEncounter(
    admin: AuthenticatedUser,
    input: EncounterAdminFieldsInput & { bossId: string; wclEncounterIds?: readonly number[] },
  ): Promise<void> {
    assertCanManageRaidCatalog(admin);
    const fields = encounterAdminFieldsSchema.parse(input);
    const { catalog, raid, boss } = await loadBossContext(input.bossId);
    const wclEncounterIds =
      input.wclEncounterIds !== undefined ? [...input.wclEncounterIds].sort((a, b) => a - b) : [...boss.wclEncounterIds];
    assertEncounterIds(catalog, {
      raidId: raid.id,
      bossId: boss.id,
      blizzardEncounterIds: fields.blizzardEncounterIds,
      wclEncounterIds,
    });
    await raidCatalogRepository.updateEncounter(boss.id, {
      name: fields.name,
      blizzardEncounterIds: fields.blizzardEncounterIds,
      wclEncounterIds,
    });
    await record(admin, "CONTENT_ENCOUNTER_UPDATED", `Encounter "${input.name}" in ${raid.name} updated.`);
    if (wclEncounterIds.length === 0) await applyDiscovery(raid.id);
  },

  async moveEncounter(admin: AuthenticatedUser, input: { bossId: string; direction: "UP" | "DOWN" }): Promise<void> {
    assertCanManageRaidCatalog(admin);
    const { raid, boss } = await loadBossContext(input.bossId);
    await assertEncounterStructureEditable(raid);
    const ordered = raid.bosses.map((row) => row.id);
    const index = ordered.indexOf(boss.id);
    const target = input.direction === "UP" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await raidCatalogRepository.setEncounterOrder(ordered);
  },

  async deleteEncounter(admin: AuthenticatedUser, bossId: string): Promise<{ name: string }> {
    assertCanManageRaidCatalog(admin);
    const { raid, boss } = await loadBossContext(bossId);
    await assertEncounterStructureEditable(raid);
    await raidCatalogRepository.deleteEncounter(
      boss.id,
      raid.bosses.filter((row) => row.id !== boss.id).map((row) => row.id),
    );
    await record(admin, "CONTENT_ENCOUNTER_DELETED", `Encounter "${boss.name}" removed from ${raid.name}.`);
    return { name: boss.name };
  },

  async createProduct(admin: AuthenticatedUser, input: CreateProductInput, now = new Date()): Promise<{ productId: string }> {
    assertCanManageRaidCatalog(admin);
    const contents = validateProductContents(input.contents, await raidRepository.loadCatalog());
    const productId = crypto.randomUUID();
    const key = await allocateUniqueProductKey(input.name, async (candidate) =>
      Boolean(await raidCatalogRepository.findProductIdByKey(candidate)),
    );
    await raidCatalogRepository.createProduct({
      id: productId,
      key,
      name: input.name,
      active: input.active,
      selectable: input.selectable,
      sortOrder: input.sortOrder,
      contents,
      now: now.toISOString(),
    });
    await record(admin, "CONTENT_PRODUCT_CREATED", `Product "${input.name}" (${key}) created.`);
    return { productId };
  },

  /** The key is immutable; contents are replaced in order. Runs and Run Setups are never rewritten. */
  async updateProduct(admin: AuthenticatedUser, input: UpdateProductInput, now = new Date()): Promise<void> {
    assertCanManageRaidCatalog(admin);
    const product = await loadProduct(input.productId);
    const contents = validateProductContents(
      input.contents,
      await raidRepository.loadCatalog(),
      new Set(product.contents.map((content) => content.raidId)),
    );
    await raidCatalogRepository.updateProduct(product.id, {
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
    assertCanManageRaidCatalog(admin);
    const product = await loadProduct(productId);
    await raidCatalogRepository.setProductFlags(product.id, { active, now: now.toISOString() });
    await record(
      admin,
      active ? "CONTENT_PRODUCT_ACTIVATED" : "CONTENT_PRODUCT_DEACTIVATED",
      `Product "${product.name}" ${active ? "activated" : "deactivated"}.`,
    );
    return { name: product.name };
  },

  async setProductSelectable(admin: AuthenticatedUser, productId: string, selectable: boolean, now = new Date()) {
    assertCanManageRaidCatalog(admin);
    const product = await loadProduct(productId);
    await raidCatalogRepository.setProductFlags(product.id, { selectable, now: now.toISOString() });
    await record(
      admin,
      "CONTENT_PRODUCT_UPDATED",
      `Product "${product.name}" ${selectable ? "shown in" : "hidden from"} selection.`,
    );
    return { name: product.name };
  },

  /** Seeded products are never hard-deleted (the bootstrap would re-create them) — deactivate them instead. */
  async deleteProduct(admin: AuthenticatedUser, productId: string): Promise<{ name: string }> {
    assertCanManageRaidCatalog(admin);
    const product = await loadProduct(productId);
    if (SEEDED_PRODUCT_IDS.has(product.id)) {
      throw new DomainError(
        "CONTENT_PRODUCT_IN_USE",
        `${product.name} is core catalog content and cannot be deleted. Deactivate it instead.`,
      );
    }
    await raidCatalogRepository.deleteProduct(product.id);
    await record(admin, "CONTENT_PRODUCT_DELETED", `Product "${product.name}" (${product.key}) deleted.`);
    return { name: product.name };
  },
};
