import { assertCanManageRaidCatalog, type AuthenticatedUser } from "@/auth/authorization";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import type { BlizzardJournalInstance } from "@/lib/blizzard/types";
import { DomainError, isDomainError } from "@/lib/errors";
import type { CatalogRaid, RaidCatalog } from "@/lib/raid-catalog";
import {
  findRaidSeason,
  findRaidSeasonForInstance,
  type RaidSeasonDefinition,
} from "@/lib/raid-seasons";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import type { WowRegion } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import {
  EMPTY_RAID_REFERENCES,
  isRaidReferenced,
  raidCatalogRepository,
  type BlizzardRaidImportWrite,
} from "@/repositories/raid-catalog.repository";
import { raidRepository } from "@/repositories/raid.repository";
import {
  findImportTarget,
  planRaidImport,
  type JournalRaid,
  type RaidImportPlan,
} from "@/services/raid-catalog-import-plan";
import { applyWclDiscovery } from "@/services/raid-catalog.service";
import type { DiscoverRaidMetadataOptions } from "@/services/warcraft-logs-raid-metadata.service";

/**
 * Raid Catalog import / sync from the Blizzard Adventure Journal — ADMIN / OWNER only.
 *
 * Every Blizzard request of an operation completes (and validates) before the
 * single write transaction starts, so a Battle.net failure writes nothing.
 * Imports are keyed by the journal instance id and idempotent. Warcraft Logs
 * ids are filled afterwards by soft discovery only (empty fields, unique
 * matches), so manual WCL mappings survive and a missing match never blocks.
 */

/** Region whose Game Data API serves the journal (journal ids are global; EU in production). */
export const RAID_CATALOG_BLIZZARD_REGION: WowRegion = "EU";

const SEEDED_RAID_IDS = new Set(WOW_RAID_CATALOG.map((raid) => raid.id));

export type RaidImportDeps = {
  /** Injected for tests; defaults to the Blizzard Game Data API. */
  fetchInstance?: (instanceId: number) => Promise<BlizzardJournalInstance | null>;
  /** Injected for tests; WCL soft discovery after the import. */
  fetchZones?: DiscoverRaidMetadataOptions["fetchZones"];
};

export type RaidImportPreview = {
  plan: RaidImportPlan;
  /** BoostingHub defaults for a new raid (from the season definition holding the instance). */
  defaults: { season: string; trackLockouts: boolean };
};

export type SeasonImportPreview = {
  season: { key: string; name: string; current: boolean };
  plans: RaidImportPlan[];
};

export type RaidImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  raidIds: string[];
};

/* ------------------------------------------------------------- Blizzard */

function blizzardFailure(instanceId: number, error: unknown): DomainError {
  if (isDomainError(error)) {
    if (error.code === "BLIZZARD_CHARACTER_NOT_FOUND") return notFound(instanceId);
    if (error.code === "BATTLENET_RATE_LIMITED") {
      return new DomainError(
        "BATTLENET_RATE_LIMITED",
        "Battle.net rate limit reached. Nothing was imported — try again in a minute.",
        429,
      );
    }
    if (error.code === "BATTLENET_AUTH_FAILED") {
      return new DomainError(
        "BATTLENET_AUTH_FAILED",
        "Battle.net rejected the server's API credentials. Nothing was imported — check BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET.",
        502,
      );
    }
  }
  return new DomainError(
    "BLIZZARD_JOURNAL_UNAVAILABLE",
    `Battle.net did not answer for journal instance ${instanceId}. Nothing was imported — try again in a minute.`,
    503,
  );
}

function notFound(instanceId: number): DomainError {
  return new DomainError(
    "BLIZZARD_JOURNAL_INSTANCE_NOT_FOUND",
    `Blizzard has no journal instance ${instanceId}. Check the id (the number in a Wowhead or Adventure Journal instance link).`,
    404,
  );
}

/** Fetch + validate one journal raid. Throws an actionable DomainError; never returns partial data. */
async function fetchJournalRaid(
  instanceId: number,
  deps: RaidImportDeps,
): Promise<JournalRaid & { expansion: string | null }> {
  if (!deps.fetchInstance && !isBlizzardConfigured()) {
    throw new DomainError(
      "BATTLENET_NOT_CONFIGURED",
      "The Battle.net API is not configured on this server. Nothing was imported.",
      503,
    );
  }
  const fetchInstance =
    deps.fetchInstance ??
    ((id: number) => blizzardApiClient.getJournalInstance(RAID_CATALOG_BLIZZARD_REGION, id));
  let instance: BlizzardJournalInstance | null;
  try {
    instance = await fetchInstance(instanceId);
  } catch (error) {
    throw blizzardFailure(instanceId, error);
  }
  if (!instance || instance.id !== instanceId) throw notFound(instanceId);
  if (instance.category !== "RAID") {
    throw new DomainError(
      "BLIZZARD_JOURNAL_NOT_RAID",
      `Journal instance ${instanceId} (${instance.name}) is ${instance.category ? `a ${instance.category.toLowerCase()}` : "not categorized"}, not a raid.`,
    );
  }
  if (instance.encounters.length === 0) {
    throw new DomainError(
      "BLIZZARD_JOURNAL_NO_ENCOUNTERS",
      `${instance.name} has no encounters in the Blizzard journal yet. Nothing was imported.`,
    );
  }
  if (
    new Set(instance.encounters.map((encounter) => encounter.id)).size !==
    instance.encounters.length
  ) {
    throw new DomainError(
      "BLIZZARD_JOURNAL_INVALID",
      `${instance.name}: the Blizzard journal lists an encounter twice.`,
      502,
    );
  }
  return {
    instanceId: instance.id,
    name: instance.name,
    encounters: instance.encounters.map((encounter) => ({
      id: encounter.id,
      name: encounter.name,
    })),
    expansion: instance.expansion ?? null,
  };
}

/* ------------------------------------------------------------- planning */

async function loadPlanningContext(): Promise<{
  catalog: RaidCatalog;
  isLocked: (raid: CatalogRaid) => boolean;
}> {
  const [catalog, references] = await Promise.all([
    raidRepository.loadCatalog(),
    raidCatalogRepository.listRaidReferenceCounts(),
  ]);
  return {
    catalog,
    isLocked: (raid) =>
      SEEDED_RAID_IDS.has(raid.id) ||
      isRaidReferenced(references.get(raid.id) ?? EMPTY_RAID_REFERENCES),
  };
}

function planFor(
  journal: JournalRaid,
  context: Awaited<ReturnType<typeof loadPlanningContext>>,
): RaidImportPlan {
  const target = findImportTarget(context.catalog.raids, journal);
  return planRaidImport({
    journal,
    target,
    structureLocked: target ? context.isLocked(target.raid) : false,
  });
}

function toWrite(
  plan: RaidImportPlan,
  newRaid: { season: string; sortOrder: number; trackLockouts: boolean },
): BlizzardRaidImportWrite {
  return {
    blizzardInstanceId: plan.instanceId,
    name: plan.name,
    raid: plan.raidId
      ? { kind: "UPDATE", id: plan.raidId }
      : { kind: "CREATE", id: crypto.randomUUID(), ...newRaid },
    bosses: plan.bosses.map((boss) => ({
      id: boss.bossId,
      name: boss.name,
      sortOrder: boss.sortOrder,
      blizzardEncounterIds: boss.blizzardEncounterIds,
    })),
    removeBossIds: plan.removedBosses.map((boss) => boss.bossId),
    staleBossIds: plan.staleBosses.map((boss) => boss.bossId),
  };
}

function nextSortOrder(catalog: RaidCatalog): number {
  return catalog.raids.reduce((max, raid) => Math.max(max, raid.sortOrder), 0) + 1;
}

function defaultsFor(journal: {
  instanceId: number;
  expansion: string | null;
}): RaidImportPreview["defaults"] {
  const season = findRaidSeasonForInstance(journal.instanceId);
  return {
    season: season?.name ?? journal.expansion ?? "",
    trackLockouts: season?.current ?? false,
  };
}

function requireSeason(key: string): RaidSeasonDefinition {
  const season = findRaidSeason(key);
  if (!season)
    throw new DomainError("CONTENT_SEASON_NOT_FOUND", "That season is not defined.", 404);
  return season;
}

/* ------------------------------------------------------------- writing */

async function applyPlans(
  admin: AuthenticatedUser,
  plans: ReadonlyArray<{ plan: RaidImportPlan; write: BlizzardRaidImportWrite }>,
  deps: RaidImportDeps,
  now: Date,
): Promise<RaidImportResult> {
  const pending = plans.filter(({ plan }) => plan.status !== "UP_TO_DATE");
  if (pending.length > 0) {
    await raidCatalogRepository.applyBlizzardRaidImports(
      pending.map(({ write }) => write),
      now.toISOString(),
    );
  }
  for (const { plan, write } of pending) {
    await activityRepository.create({
      userId: admin.id,
      type: plan.raidId ? "CONTENT_RAID_BLIZZARD_REFRESHED" : "CONTENT_RAID_IMPORTED",
      message: plan.raidId
        ? `Raid "${plan.name}" refreshed from Blizzard (instance ${plan.instanceId}).`
        : `Raid "${plan.name}" imported from Blizzard (instance ${plan.instanceId}, ${write.bosses.length} bosses).`,
    });
  }
  // Soft WCL discovery: fills empty WCL ids on unique matches only; never fails the import.
  for (const { write } of plans) {
    await applyWclDiscovery(write.raid.id, { fetchZones: deps.fetchZones }, now);
  }
  return {
    created: pending.filter(({ plan }) => plan.raidId == null).length,
    updated: pending.filter(({ plan }) => plan.raidId != null).length,
    unchanged: plans.length - pending.length,
    raidIds: plans.map(({ write }) => write.raid.id),
  };
}

/* ------------------------------------------------------------- service */

export const raidCatalogImportService = {
  async previewRaidImport(
    admin: AuthenticatedUser,
    journalInstanceId: number,
    deps: RaidImportDeps = {},
  ): Promise<RaidImportPreview> {
    assertCanManageRaidCatalog(admin);
    const journal = await fetchJournalRaid(journalInstanceId, deps);
    return { plan: planFor(journal, await loadPlanningContext()), defaults: defaultsFor(journal) };
  },

  /** Import (or re-import) one journal instance. Season / lockout tracking apply only to a new raid. */
  async importRaid(
    admin: AuthenticatedUser,
    input: { journalInstanceId: number; season?: string; trackLockouts?: boolean },
    deps: RaidImportDeps = {},
    now = new Date(),
  ): Promise<RaidImportResult & { plan: RaidImportPlan }> {
    assertCanManageRaidCatalog(admin);
    const journal = await fetchJournalRaid(input.journalInstanceId, deps);
    const context = await loadPlanningContext();
    const plan = planFor(journal, context);
    const defaults = defaultsFor(journal);
    const season = input.season?.trim() || defaults.season;
    if (!plan.raidId && !season) {
      throw new DomainError("CONTENT_SEASON_REQUIRED", "Choose a season for the new raid.");
    }
    const write = toWrite(plan, {
      season,
      sortOrder: nextSortOrder(context.catalog),
      trackLockouts: input.trackLockouts ?? defaults.trackLockouts,
    });
    return { ...(await applyPlans(admin, [{ plan, write }], deps, now)), plan };
  },

  async previewSeasonImport(
    admin: AuthenticatedUser,
    seasonKey: string,
    deps: RaidImportDeps = {},
  ): Promise<SeasonImportPreview> {
    assertCanManageRaidCatalog(admin);
    const season = requireSeason(seasonKey);
    const journals = await Promise.all(
      season.journalInstanceIds.map((id) => fetchJournalRaid(id, deps)),
    );
    const context = await loadPlanningContext();
    return {
      season: { key: season.key, name: season.name, current: season.current },
      plans: journals.map((journal) => planFor(journal, context)),
    };
  },

  /**
   * Import every raid of a code-defined season in one transaction. New raids get
   * the season name; lockout tracking defaults to on for the current season.
   * Existing raids only receive Blizzard-owned metadata.
   */
  async importSeason(
    admin: AuthenticatedUser,
    input: { seasonKey: string; trackLockouts?: boolean },
    deps: RaidImportDeps = {},
    now = new Date(),
  ): Promise<RaidImportResult> {
    assertCanManageRaidCatalog(admin);
    const season = requireSeason(input.seasonKey);
    const journals = await Promise.all(
      season.journalInstanceIds.map((id) => fetchJournalRaid(id, deps)),
    );
    const context = await loadPlanningContext();
    let sortOrder = nextSortOrder(context.catalog);
    const plans = journals.map((journal) => {
      const plan = planFor(journal, context);
      const write = toWrite(plan, {
        season: season.name,
        sortOrder: plan.raidId ? 0 : sortOrder++,
        trackLockouts: input.trackLockouts ?? season.current,
      });
      return { plan, write };
    });
    const result = await applyPlans(admin, plans, deps, now);
    await activityRepository.create({
      userId: admin.id,
      type: "CONTENT_SEASON_IMPORTED",
      message: `${season.name} imported from Blizzard: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged.`,
    });
    return result;
  },

  async previewRaidRefresh(
    admin: AuthenticatedUser,
    raidId: string,
    deps: RaidImportDeps = {},
  ): Promise<RaidImportPreview> {
    assertCanManageRaidCatalog(admin);
    const instanceId = await requireLinkedInstance(raidId);
    const journal = await fetchJournalRaid(instanceId, deps);
    return { plan: planFor(journal, await loadPlanningContext()), defaults: defaultsFor(journal) };
  },

  /** Refresh Blizzard-owned metadata (raid name, boss names, order, encounter ids) of one imported raid. */
  async refreshRaid(
    admin: AuthenticatedUser,
    raidId: string,
    deps: RaidImportDeps = {},
    now = new Date(),
  ): Promise<RaidImportResult & { plan: RaidImportPlan }> {
    assertCanManageRaidCatalog(admin);
    const instanceId = await requireLinkedInstance(raidId);
    const journal = await fetchJournalRaid(instanceId, deps);
    const plan = planFor(journal, await loadPlanningContext());
    const write = toWrite(plan, { season: "", sortOrder: 0, trackLockouts: false });
    return { ...(await applyPlans(admin, [{ plan, write }], deps, now)), plan };
  },
};

async function requireLinkedInstance(raidId: string): Promise<number> {
  const raid = (await raidRepository.loadCatalog()).findById(raidId);
  if (!raid) throw new DomainError("CONTENT_RAID_NOT_FOUND", "Raid was not found.", 404);
  if (raid.blizzardInstanceId == null) {
    throw new DomainError(
      "CONTENT_RAID_NOT_IMPORTED",
      `${raid.name} is not linked to Blizzard yet. Import it with its journal instance id first.`,
    );
  }
  return raid.blizzardInstanceId;
}
