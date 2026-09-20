import {
  warcraftLogsApiClient,
  type WarcraftLogsRankingMetric,
  type WarcraftLogsRankingRole,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { findRaidCatalogById, raidContentDisplayName } from "@/lib/wow-raid-catalog";
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
    warcraftLogsId: string | null;
  };
};

type FetchKey = {
  characterId: string;
  warcraftLogsId: string;
  zoneId: number;
  encounterId: number;
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
    return match?.role === "DPS";
  }
  return input.primaryRole === "DPS";
}

/**
 * Roles to query for WCL per offered role / roster column.
 * DPS is included only for real DPS specs — WCL otherwise returns healer damage
 * percentiles that look like "DPS" but are not.
 * Tank/Healer stay queryable; missing parses simply stay empty in that column.
 */
export function rolesRelevantForWclPerformance(input: {
  offeredRoles: CharacterRole[];
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
}): CharacterRole[] {
  const offered = [...new Set(input.offeredRoles)];
  const base = offered.length > 0 ? offered : [input.primaryRole];
  const allowDps = characterIsRealDpsSpec(input);
  return base.filter((role) => (role === "DPS" ? allowDps : true));
}

export function buildMetricKey(metricKeyBase: string, specName: string | null): string {
  return specName ? `${metricKeyBase}:${specName}` : metricKeyBase;
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
}): Promise<Map<string, WclPerformanceRaidSegment[]>> {
  const result = new Map<string, WclPerformanceRaidSegment[]>();
  if (!warcraftLogsApiClient.isConfigured()) {
    return result;
  }

  const wclDifficulty = WCL_DIFFICULTY[input.difficulty];
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const contentsWithWcl = [...input.contents]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((content) => {
      const catalog = findRaidCatalogById(content.raidId);
      if (!catalog?.warcraftLogsZoneId) return null;
      return {
        raidId: content.raidId,
        raidName: raidContentDisplayName(content.raidId, content.raidName),
        zoneId: catalog.warcraftLogsZoneId,
        encounterId: catalog.warcraftLogsEncounterId ?? 0,
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
      roles: Array<{ role: CharacterRole; specLabel: string | null; key: string }>;
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
    });
    if (rolesToQuery.length === 0) continue;

    const raids: (typeof signupPlans)[number]["raids"] = [];
    for (const content of contentsWithWcl) {
      const roles: (typeof raids)[number]["roles"] = [];
      for (const offeredRole of rolesToQuery) {
        const { metric, role, metricKeyBase } = metricForRole(offeredRole);
        const specName = specNameForOfferedRole(
          booster.character.wowClass,
          booster.character.specialization,
          offeredRole,
        );
        const metricKey = buildMetricKey(metricKeyBase, specName);
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
        });
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

  for (const [keyId, key] of fetchKeys) {
    const hit = cacheLookup(cached, key);
    if (hit && isFresh(hit, nowMs)) {
      resolved.set(keyId, { bestPct: hit.bestPct, avgPct: hit.avgPct });
    }
  }

  const toFetch = [...fetchKeys.entries()].filter(([keyId]) => !resolved.has(keyId));
  await mapPool(toFetch, WCL_PERFORMANCE_FETCH_CONCURRENCY, async ([keyId, key]) => {
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

  for (const plan of signupPlans) {
    const segments: WclPerformanceRaidSegment[] = [];
    for (const raid of plan.raids) {
      const roles: WclPerformanceRoleSegment[] = [];
      for (const rolePlan of raid.roles) {
        const values = resolved.get(rolePlan.key);
        if (!values) continue;
        if (values.bestPct == null && values.avgPct == null) continue;
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
