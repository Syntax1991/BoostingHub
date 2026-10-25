import {
  warcraftLogsApiClient,
  type WarcraftLogsRankingMetric,
  type WarcraftLogsRankingRole,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { runAfterResponse } from "@/lib/after-response";
import { effectiveWclRankingEncounterId, type CatalogRaid, type RaidCatalog } from "@/lib/raid-catalog";
import { raidContentDisplayName } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { findSpecialization } from "@/lib/wow-specializations";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import {
  characterWclPerformanceRepository,
  type CharacterWclPerformanceRecord,
} from "@/repositories/character-wcl-performance.repository";
import type { WclPerformanceRaidSegment, WclPerformanceRoleSegment } from "@/lib/wcl-performance-display";

export type { WclPerformanceRaidSegment, WclPerformanceRoleSegment } from "@/lib/wcl-performance-display";
export { formatWclPerformanceRaidLine } from "@/lib/wcl-performance-display";

export const WCL_PERFORMANCE_TTL_MS = 12 * 60 * 60 * 1000;
export const WCL_PERFORMANCE_FETCH_CONCURRENCY = 4;

/** WCL difficulty filter values for retail raids. */
export const WCL_DIFFICULTY: Record<RaidDifficulty, number> = {
  NORMAL: 3,
  HEROIC: 4,
  MYTHIC: 5,
};

type ContentSlice = {
  raidId: string;
  raidName: string;
  sortOrder: number;
};

type BoosterPerfInput = {
  signupId: string;
  offeredRoles: CharacterRole[];
  character: {
    id: string;
    wowClass: WowClass;
    specialization: string | null;
    primaryRole: CharacterRole;
    /** Additional playable specs — each may own its own cached WCL metric. */
    playableSpecs?: readonly string[];
    warcraftLogsId: string | null;
  };
};

type FetchKey = {
  characterId: string;
  warcraftLogsId: string;
  zoneId: number;
  encounterId: number;
  /** Zone-wide query restricted to this raid's encounters (shared zone); null → plain zone-wide. */
  scopeEncounterIds: readonly number[] | null;
  difficulty: number;
  metricKey: string;
  metric: WarcraftLogsRankingMetric;
  role?: WarcraftLogsRankingRole;
  specName?: string;
};

function metricForRole(role: CharacterRole): {
  metric: WarcraftLogsRankingMetric;
  role?: WarcraftLogsRankingRole;
  metricKeyBase: string;
} {
  if (role === "HEALER") return { metric: "hps", metricKeyBase: "hps" };
  if (role === "TANK") return { metric: "dps", role: "Tank", metricKeyBase: "tank-dps" };
  return { metric: "dps", metricKeyBase: "dps" };
}

/**
 * Spec name for WCL when the character's specialization matches the offered role.
 */
export function specNameForOfferedRole(
  wowClass: WowClass,
  specialization: string | null,
  offeredRole: CharacterRole,
): string | null {
  if (!specialization?.trim()) return null;
  const match = findSpecialization(wowClass, specialization);
  if (!match || match.role !== offeredRole) return null;
  return match.name;
}

/** True DPS bracket only — never healer/tank damage parses under metric:dps. */
export function characterIsRealDpsSpec(input: {
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
}): boolean {
  if (input.specialization?.trim()) {
    const match = findSpecialization(input.wowClass, input.specialization);
    return match != null && (match.role === "MELEE_DPS" || match.role === "RANGED_DPS");
  }
  return input.primaryRole === "MELEE_DPS" || input.primaryRole === "RANGED_DPS" || input.primaryRole === "DPS";
}

/**
 * Roles to query for WCL per offered role / roster column.
 * DPS subtypes are included only for real DPS specs — WCL otherwise returns
 * healer damage percentiles that look like DPS but are not.
 * Tank/Healer stay queryable; missing parses simply stay empty in that column.
 */
export function rolesRelevantForWclPerformance(input: {
  offeredRoles: CharacterRole[];
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
  playableSpecs?: readonly string[];
}): CharacterRole[] {
  const offered = [...new Set(input.offeredRoles)];
  const base = offered.length > 0 ? offered : [input.primaryRole];
  const playableIsDps = (input.playableSpecs ?? []).some((spec) => {
    const match = findSpecialization(input.wowClass, spec);
    return match != null && (match.role === "MELEE_DPS" || match.role === "RANGED_DPS");
  });
  const allowDps = characterIsRealDpsSpec(input) || playableIsDps;
  return base.filter((role) => (role === "DPS" || role === "MELEE_DPS" || role === "RANGED_DPS" ? allowDps : true));
}

/**
 * Catalog specs (primary ∪ playable) that map to this offered role.
 * Empty → role-only metric key (historic / no matching spec configured).
 */
export function specsForOfferedRole(
  wowClass: WowClass,
  specialization: string | null,
  playableSpecs: readonly string[] | undefined,
  offeredRole: CharacterRole,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const consider = (raw: string | null | undefined) => {
    if (!raw?.trim()) return;
    const match = findSpecialization(wowClass, raw);
    if (!match || match.role !== offeredRole) return;
    if (seen.has(match.name)) return;
    seen.add(match.name);
    names.push(match.name);
  };
  consider(specialization);
  for (const spec of playableSpecs ?? []) consider(spec);
  return names;
}

export function buildMetricKey(metricKeyBase: string, specName: string | null): string {
  return specName ? `${metricKeyBase}:${specName}` : metricKeyBase;
}

/** Cache metricKey suffix for zone rankings restricted to one raid's encounters. */
export const RAID_SCOPED_METRIC_SUFFIX = "@raid";

/**
 * Encounters to restrict a zone-wide ranking to: only for a multi-boss raid
 * whose WCL zone also holds another catalog raid (e.g. The Venomous Abyss in
 * zone 53 next to The Tidebound Grotto and Kith'ix) — zone-wide averages would
 * otherwise include those raids' bosses. Unshared zones stay plain zone-wide.
 */
export function sharedZoneEncounterScope(
  raid: Pick<CatalogRaid, "id" | "wclZoneId" | "bosses">,
  catalog: Pick<RaidCatalog, "raids">,
): number[] | null {
  if (raid.wclZoneId == null) return null;
  const shared = catalog.raids.some((other) => other.id !== raid.id && other.wclZoneId === raid.wclZoneId);
  if (!shared) return null;
  const ids = [...new Set(raid.bosses.flatMap((boss) => boss.wclEncounterIds))];
  return ids.length > 0 ? ids : null;
}

function isFresh(row: CharacterWclPerformanceRecord, nowMs: number): boolean {
  return nowMs - new Date(row.fetchedAt).getTime() < WCL_PERFORMANCE_TTL_MS;
}

function cacheLookup(
  rows: CharacterWclPerformanceRecord[],
  key: Omit<FetchKey, "warcraftLogsId" | "metric" | "role" | "specName">,
): CharacterWclPerformanceRecord | null {
  return (
    rows.find(
      (row) =>
        row.characterId === key.characterId &&
        row.zoneId === key.zoneId &&
        row.encounterId === key.encounterId &&
        row.difficulty === key.difficulty &&
        row.metricKey === key.metricKey,
    ) ?? null
  );
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}

/** WCL refreshes already scheduled in this process (per fetch key) — parallel page views share one. */
const refreshesInFlight = new Set<string>();

/** Fetch the given keys from Warcraft Logs (bounded concurrency) and upsert the cache rows. */
async function fetchAndStoreWclPerformance(
  toFetch: ReadonlyArray<[string, FetchKey]>,
  cached: Awaited<ReturnType<typeof characterWclPerformanceRepository.listForCharacters>>,
  nowIso: string,
  resolved: Map<string, { bestPct: number | null; avgPct: number | null }>,
): Promise<void> {
  await mapPool([...toFetch], WCL_PERFORMANCE_FETCH_CONCURRENCY, async ([keyId, key]) => {
    const stale = cacheLookup(cached, key);
    try {
      const response = await warcraftLogsApiClient.fetchZoneRankings({
        warcraftLogsId: key.warcraftLogsId,
        zoneId: key.zoneId,
        difficulty: key.difficulty,
        metric: key.metric,
        role: key.role,
        specName: key.specName,
        encounterId: key.encounterId > 0 ? key.encounterId : undefined,
        encounterIds: key.scopeEncounterIds ?? undefined,
      });

      if (response.status === "SUCCESS") {
        const bestPct = roundPct(response.rankings.bestPerformanceAverage);
        const avgPct = roundPct(response.rankings.medianPerformanceAverage);
        await characterWclPerformanceRepository.upsert({
          characterId: key.characterId,
          zoneId: key.zoneId,
          encounterId: key.encounterId,
          difficulty: key.difficulty,
          metricKey: key.metricKey,
          bestPct,
          avgPct,
          fetchedAt: nowIso,
        });
        resolved.set(keyId, { bestPct, avgPct });
        return;
      }

      if (response.status === "NOT_FOUND") {
        await characterWclPerformanceRepository.upsert({
          characterId: key.characterId,
          zoneId: key.zoneId,
          encounterId: key.encounterId,
          difficulty: key.difficulty,
          metricKey: key.metricKey,
          bestPct: null,
          avgPct: null,
          fetchedAt: nowIso,
        });
        resolved.set(keyId, { bestPct: null, avgPct: null });
        return;
      }

      // TEMPORARY_FAILURE / NOT_CONFIGURED — keep stale cache when present.
      if (stale) {
        resolved.set(keyId, { bestPct: stale.bestPct, avgPct: stale.avgPct });
      }
    } catch {
      if (stale) {
        resolved.set(keyId, { bestPct: stale.bestPct, avgPct: stale.avgPct });
      }
    }
  });
}

function roundPct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Resolve Best/Avg WCL percentiles for roster BOOSTER rows.
 * Per Run content × per offered role. Informational only — never throws.
 */
export async function resolveRosterWclPerformance(input: {
  difficulty: RaidDifficulty;
  contents: ContentSlice[];
  boosters: BoosterPerfInput[];
  now?: Date;
  /**
   * When false, only use CharacterWclPerformance rows already in the DB
   * (fresh or stale). Never fans out to the Warcraft Logs API.
   * Roster Builder uses cache-only to keep dialog open bounded.
   */
  allowRemoteFetch?: boolean;
  /**
   * With remote fetching allowed: answer from the DB cache right away (stale
   * rows included) and refresh missing / stale rows AFTER the response
   * (`after()`), so page renders never wait on Warcraft Logs. The next view
   * shows the refreshed values. Outside a request nothing is refreshed.
   */
  deferRemoteFetch?: boolean;
  /** DB raid catalog (WCL zone / ranking encounter); loaded once when omitted. */
  catalog?: RaidCatalog;
}): Promise<Map<string, WclPerformanceRaidSegment[]>> {
  const result = new Map<string, WclPerformanceRaidSegment[]>();
  const allowRemoteFetch = input.allowRemoteFetch !== false;
  const deferRemoteFetch = allowRemoteFetch && input.deferRemoteFetch === true;
  // Inline remote mode with no API config → empty. Cache-only / deferred still read DB rows.
  if (allowRemoteFetch && !deferRemoteFetch && !warcraftLogsApiClient.isConfigured()) {
    return result;
  }

  const wclDifficulty = WCL_DIFFICULTY[input.difficulty];
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const catalog = input.catalog ?? (await raidRepository.loadCatalog());

  const contentsWithWcl = [...input.contents]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((content) => {
      const raid = catalog.findById(content.raidId);
      if (!raid?.wclZoneId) return null;
      const encounterId = effectiveWclRankingEncounterId(raid) ?? 0;
      return {
        raidId: content.raidId,
        raidName: raidContentDisplayName(content.raidId, content.raidName),
        zoneId: raid.wclZoneId,
        encounterId,
        scopeEncounterIds: encounterId > 0 ? null : sharedZoneEncounterScope(raid, catalog),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (contentsWithWcl.length === 0) {
    return result;
  }

  const characterIds = [
    ...new Set(
      input.boosters
        .filter((row) => row.character.warcraftLogsId?.trim() && row.offeredRoles.length > 0)
        .map((row) => row.character.id),
    ),
  ];
  const cached = await characterWclPerformanceRepository.listForCharacters(characterIds);

  const fetchKeys = new Map<string, FetchKey>();
  const signupPlans: Array<{
    signupId: string;
    raids: Array<{
      raidId: string;
      raidName: string;
      roles: Array<{
        role: CharacterRole;
        specLabel: string | null;
        key: string;
        /** Cache-only role-wide metric key when the spec-scoped row is empty (no extra remote fetch). */
        fallbackCacheKey: Omit<FetchKey, "warcraftLogsId" | "metric" | "role" | "specName"> | null;
      }>;
    }>;
  }> = [];

  for (const booster of input.boosters) {
    const wclId = booster.character.warcraftLogsId?.trim() || null;
    if (!wclId) continue;

    const rolesToQuery = rolesRelevantForWclPerformance({
      offeredRoles: booster.offeredRoles,
      wowClass: booster.character.wowClass,
      specialization: booster.character.specialization,
      primaryRole: booster.character.primaryRole,
      playableSpecs: booster.character.playableSpecs,
    });
    if (rolesToQuery.length === 0) continue;

    const raids: (typeof signupPlans)[number]["raids"] = [];
    for (const content of contentsWithWcl) {
      const roles: (typeof raids)[number]["roles"] = [];
      const scopeSuffix = content.scopeEncounterIds ? RAID_SCOPED_METRIC_SUFFIX : "";
      for (const offeredRole of rolesToQuery) {
        const { metric, role, metricKeyBase } = metricForRole(offeredRole);
        const specNames = specsForOfferedRole(
          booster.character.wowClass,
          booster.character.specialization,
          booster.character.playableSpecs,
          offeredRole,
        );
        const labels = specNames.length > 0 ? specNames : [null];
        const baseMetricKey = buildMetricKey(metricKeyBase, null) + scopeSuffix;
        const fallbackCacheKey =
          specNames.length > 0
            ? {
                characterId: booster.character.id,
                zoneId: content.zoneId,
                encounterId: content.encounterId,
                scopeEncounterIds: content.scopeEncounterIds,
                difficulty: wclDifficulty,
                metricKey: baseMetricKey,
              }
            : null;
        for (const specName of labels) {
          // Raid-scoped values get their own cache key (never mixed with zone-wide rows).
          const metricKey = buildMetricKey(metricKeyBase, specName) + scopeSuffix;
          const keyId = [
            booster.character.id,
            content.zoneId,
            content.encounterId,
            wclDifficulty,
            metricKey,
          ].join("|");
          if (!fetchKeys.has(keyId)) {
            fetchKeys.set(keyId, {
              characterId: booster.character.id,
              warcraftLogsId: wclId,
              zoneId: content.zoneId,
              encounterId: content.encounterId,
              scopeEncounterIds: content.scopeEncounterIds,
              difficulty: wclDifficulty,
              metricKey,
              metric,
              role,
              specName: specName ?? undefined,
            });
          }
          roles.push({
            role: offeredRole,
            specLabel: specName,
            key: keyId,
            fallbackCacheKey: specName ? fallbackCacheKey : null,
          });
        }
      }
      if (roles.length > 0) {
        raids.push({
          raidId: content.raidId,
          raidName: content.raidName,
          roles,
        });
      }
    }
    if (raids.length > 0) {
      signupPlans.push({ signupId: booster.signupId, raids });
    }
  }

  const resolved = new Map<string, { bestPct: number | null; avgPct: number | null }>();

  const inlineFetch = allowRemoteFetch && !deferRemoteFetch;
  const toRefresh: Array<[string, FetchKey]> = [];
  for (const [keyId, key] of fetchKeys) {
    const hit = cacheLookup(cached, key);
    const fresh = hit != null && isFresh(hit, nowMs);
    if (!fresh) toRefresh.push([keyId, key]);
    if (!hit) continue;
    if (inlineFetch && !fresh) continue;
    // Cache-only / deferred: accept stale rows. Inline remote mode: only fresh rows here; stale go to fetch.
    resolved.set(keyId, { bestPct: hit.bestPct, avgPct: hit.avgPct });
  }

  if (inlineFetch) {
    await fetchAndStoreWclPerformance(toRefresh, cached, nowIso, resolved);
  } else if (deferRemoteFetch && toRefresh.length > 0 && warcraftLogsApiClient.isConfigured()) {
    const pending = toRefresh.filter(([keyId]) => !refreshesInFlight.has(keyId));
    if (pending.length > 0) {
      for (const [keyId] of pending) refreshesInFlight.add(keyId);
      runAfterResponse(async () => {
        try {
          await fetchAndStoreWclPerformance(pending, cached, new Date().toISOString(), new Map());
        } finally {
          for (const [keyId] of pending) refreshesInFlight.delete(keyId);
        }
      }, () => {
        for (const [keyId] of pending) refreshesInFlight.delete(keyId);
      });
    }
  }

  for (const plan of signupPlans) {
    const segments: WclPerformanceRaidSegment[] = [];
    for (const raid of plan.raids) {
      const roles: WclPerformanceRoleSegment[] = [];
      for (const rolePlan of raid.roles) {
        const values = pickResolvedPerformance(resolved, cached, rolePlan.key, rolePlan.fallbackCacheKey);
        if (!values) continue;
        roles.push({
          role: rolePlan.role,
          specLabel: rolePlan.specLabel,
          bestPct: values.bestPct,
          avgPct: values.avgPct,
        });
      }
      if (roles.length > 0) {
        segments.push({ raidId: raid.raidId, raidName: raid.raidName, roles });
      }
    }
    if (segments.length > 0) {
      result.set(plan.signupId, segments);
    }
  }

  return result;
}

/**
 * Prefer the spec-scoped resolved row; fall back to a role-wide CharacterWclPerformance
 * cache hit when that row is missing or empty. Cache-only — does not schedule a remote fetch.
 */
function pickResolvedPerformance(
  resolved: Map<string, { bestPct: number | null; avgPct: number | null }>,
  cached: CharacterWclPerformanceRecord[],
  primaryKey: string,
  fallbackCacheKey: Omit<FetchKey, "warcraftLogsId" | "metric" | "role" | "specName"> | null,
): { bestPct: number | null; avgPct: number | null } | null {
  const primary = resolved.get(primaryKey);
  if (primary && (primary.bestPct != null || primary.avgPct != null)) return primary;
  if (fallbackCacheKey) {
    const hit = cacheLookup(cached, fallbackCacheKey);
    if (hit && (hit.bestPct != null || hit.avgPct != null)) {
      return { bestPct: hit.bestPct, avgPct: hit.avgPct };
    }
  }
  return null;
}
