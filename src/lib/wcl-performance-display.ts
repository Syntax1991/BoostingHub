import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { CharacterRole } from "@/models/enums";

export type WclPerformanceRoleSegment = {
  role: CharacterRole;
  /** Spec label when specialization matches this role; otherwise null. */
  specLabel: string | null;
  bestPct: number | null;
  avgPct: number | null;
};

export type WclPerformanceRaidSegment = {
  raidId: string;
  raidName: string;
  roles: WclPerformanceRoleSegment[];
};

/** Metric-oriented label: Healer → HPS, DPS → DPS, Tank → Tank. */
export function wclMetricLabel(role: CharacterRole, specLabel: string | null): string {
  const base = role === "HEALER" ? "HPS" : role === "DPS" ? "DPS" : CHARACTER_ROLE_LABELS.TANK;
  return specLabel ? `${base} (${specLabel})` : base;
}

/** Compact display line for one raid segment. */
export function formatWclPerformanceRaidLine(segment: WclPerformanceRaidSegment): string {
  const roleParts = segment.roles.map((role) => {
    const label = wclMetricLabel(role.role, role.specLabel);
    const best = role.bestPct != null ? `best ${role.bestPct}%` : null;
    const avg = role.avgPct != null ? `avg ${role.avgPct}%` : null;
    const stats = [best, avg].filter(Boolean).join(" · ");
    return `${label} ${stats}`;
  });
  return `${segment.raidName} · ${roleParts.join(" · ")}`;
}

/**
 * Roster columns repeat multi-role signups — keep only the column's role.
 * Empty when that role has no parses (do not fall back to another metric).
 */
export function filterWclPerformanceForGroupRole(
  segments: WclPerformanceRaidSegment[],
  groupRole: CharacterRole | null,
): WclPerformanceRaidSegment[] {
  if (!groupRole) return segments;
  return segments
    .map((segment) => ({
      ...segment,
      roles: segment.roles.filter((role) => role.role === groupRole),
    }))
    .filter((segment) => segment.roles.length > 0);
}
