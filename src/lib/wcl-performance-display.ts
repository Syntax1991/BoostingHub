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

/**
 * Warcraft Logs percentile quality colors (character page / rankings).
 * Thresholds match WCL: grey → green → blue → purple → orange → pink → gold.
 */
export function wclPercentileColor(pct: number): string {
  if (!Number.isFinite(pct)) return "#9d9d9d";
  if (pct >= 100) return "#e5cc80";
  if (pct >= 99) return "#e268a8";
  if (pct >= 95) return "#ff8000";
  if (pct >= 75) return "#a335ee";
  if (pct >= 50) return "#0070dd";
  if (pct >= 25) return "#1eff00";
  return "#9d9d9d";
}

/** Metric-oriented label: Healer → HPS, DPS → DPS, Tank → Tank. */
export function wclMetricLabel(role: CharacterRole, specLabel: string | null): string {
  const base = role === "HEALER" ? "HPS" : role === "DPS" ? "DPS" : CHARACTER_ROLE_LABELS.TANK;
  return specLabel ? `${base} (${specLabel})` : base;
}

export type WclPerformanceLinePart =
  | { kind: "text"; text: string }
  | { kind: "pct"; label: "best" | "avg"; value: number };

/** Structured line parts so UI can colorize percentile values. */
export function wclPerformanceRaidLineParts(segment: WclPerformanceRaidSegment): WclPerformanceLinePart[] {
  const parts: WclPerformanceLinePart[] = [{ kind: "text", text: `${segment.raidName} · ` }];
  segment.roles.forEach((role, roleIndex) => {
    if (roleIndex > 0) parts.push({ kind: "text", text: " · " });
    parts.push({ kind: "text", text: `${wclMetricLabel(role.role, role.specLabel)} ` });
    const stats: Array<{ label: "best" | "avg"; value: number }> = [];
    if (role.bestPct != null) stats.push({ label: "best", value: role.bestPct });
    if (role.avgPct != null) stats.push({ label: "avg", value: role.avgPct });
    stats.forEach((stat, statIndex) => {
      if (statIndex > 0) parts.push({ kind: "text", text: " · " });
      parts.push({ kind: "text", text: `${stat.label} ` });
      parts.push({ kind: "pct", label: stat.label, value: stat.value });
    });
  });
  return parts;
}

/** Compact plain-text line (tests / non-React). */
export function formatWclPerformanceRaidLine(segment: WclPerformanceRaidSegment): string {
  return wclPerformanceRaidLineParts(segment)
    .map((part) => (part.kind === "text" ? part.text : `${part.value}%`))
    .join("");
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
