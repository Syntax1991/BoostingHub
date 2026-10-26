import { isDpsRole } from "@/lib/character-roles";
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
  /**
   * `zone` = multi-boss Best Perf. Avg (`zoneRankings.bestPerformanceAverage` over
   * all bosses). `encounter` = single-boss lair Best % (e.g. Tide / Kith'ix).
   * Tile resolution prefers `zone` so a Bundle with Tide-first does not show a
   * lone boss 100 over Venomous 94.4.
   */
  rankingKind?: "zone" | "encounter";
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

/** Metric-oriented label: Healer → HPS, DPS subtypes → DPS, Tank → Tank. */
export function wclMetricLabel(role: CharacterRole, specLabel: string | null): string {
  const base =
    role === "HEALER"
      ? "HPS"
      : role === "DPS" || role === "MELEE_DPS" || role === "RANGED_DPS"
        ? "DPS"
        : CHARACTER_ROLE_LABELS.TANK;
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
      // Display names match WCL: Best Perf. Avg / Median Perf. Avg (not a single-boss "Best").
      parts.push({
        kind: "text",
        text: `${stat.label === "best" ? "Best Perf. Avg" : "Median Perf. Avg"} `,
      });
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
function roleMatchesGroupColumn(role: CharacterRole, groupRole: CharacterRole): boolean {
  if (role === groupRole) return true;
  // Roster DPS column is a composition bucket covering concrete subtypes + legacy DPS.
  if (groupRole === "DPS") return isDpsRole(role);
  // Historic offers were stored as generic DPS. A resolved Melee/Ranged column still shows those parses.
  if ((groupRole === "MELEE_DPS" || groupRole === "RANGED_DPS") && role === "DPS") return true;
  return false;
}

export function filterWclPerformanceForGroupRole(
  segments: WclPerformanceRaidSegment[],
  groupRole: CharacterRole | null,
): WclPerformanceRaidSegment[] {
  if (!groupRole) return segments;
  return segments
    .map((segment) => ({
      ...segment,
      roles: segment.roles.filter((role) => roleMatchesGroupColumn(role.role, groupRole)),
    }))
    .filter((segment) => segment.roles.length > 0);
}

/**
 * Prefer multi-boss zone Best Perf. Avg over single-boss encounter Best %.
 * Within each kind, keep RunRaidContent order. Never take max across raids.
 */
function segmentsForMetricPreference(
  segments: WclPerformanceRaidSegment[],
): WclPerformanceRaidSegment[] {
  const zone = segments.filter((segment) => segment.rankingKind !== "encounter");
  return zone.length > 0 ? zone : segments;
}

/**
 * Best Perf. Avg / Median Perf. Avg for sort/filter.
 * Prefer zone (all-bosses) Best Perf. Avg over a single-boss lair parse when
 * both appear on a Bundle run (Tide-first must not replace Venomous 94.4 with 100).
 */
export function wclPerformanceMetricValue(
  segments: WclPerformanceRaidSegment[],
  groupRole: CharacterRole | null,
  metric: "best" | "avg",
): number | null {
  const scoped = segmentsForMetricPreference(filterWclPerformanceForGroupRole(segments, groupRole));
  for (const segment of scoped) {
    for (const role of segment.roles) {
      const value = metric === "best" ? role.bestPct : role.avgPct;
      if (value == null || !Number.isFinite(value)) continue;
      return value;
    }
  }
  return null;
}

/**
 * Multi-line tooltip for Signup tiles — per raid Best Perf. Avg / Median Perf. Avg.
 * Empty segments → quiet “no data” copy (never invent percentiles).
 */
export function formatWclPerformanceTooltip(
  segments: WclPerformanceRaidSegment[],
  groupRole: CharacterRole | null = null,
): string {
  const scoped = filterWclPerformanceForGroupRole(segments, groupRole);
  if (scoped.length === 0) {
    return "No Warcraft Logs performance for this run content.";
  }
  const blocks: string[] = [];
  for (const segment of scoped) {
    for (const role of segment.roles) {
      const lines = [segment.raidName];
      if (role.specLabel) lines.push(role.specLabel);
      lines.push(wclMetricLabel(role.role, null));
      if (role.bestPct != null) lines.push(`Best Perf. Avg: ${formatPct(role.bestPct)}`);
      if (role.avgPct != null) lines.push(`Median Perf. Avg: ${formatPct(role.avgPct)}`);
      if (role.bestPct == null && role.avgPct == null) lines.push("no percentile");
      blocks.push(lines.join("\n"));
    }
  }
  return blocks.join("\n\n");
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export type WclPerfFilter =
  | "ALL"
  | "HAS"
  | "NONE"
  | "GE_25"
  | "GE_50"
  | "GE_75"
  | "GE_95";

export type WclPerfSort = "DEFAULT" | "BEST_DESC" | "BEST_ASC" | "AVG_DESC" | "AVG_ASC";

export function matchesWclPerfFilter(
  segments: WclPerformanceRaidSegment[],
  groupRole: CharacterRole | null,
  filter: WclPerfFilter,
): boolean {
  if (filter === "ALL") return true;
  const best = wclPerformanceMetricValue(segments, groupRole, "best");
  if (filter === "HAS") return best != null;
  if (filter === "NONE") return best == null;
  if (best == null) return false;
  if (filter === "GE_25") return best >= 25;
  if (filter === "GE_50") return best >= 50;
  if (filter === "GE_75") return best >= 75;
  return best >= 95;
}

export function compareByWclPerf(
  left: WclPerformanceRaidSegment[],
  right: WclPerformanceRaidSegment[],
  leftRole: CharacterRole | null,
  rightRole: CharacterRole | null,
  sort: WclPerfSort,
): number {
  if (sort === "DEFAULT") return 0;
  const metric = sort.startsWith("AVG") ? "avg" : "best";
  const descending = sort.endsWith("DESC");
  const a = wclPerformanceMetricValue(left, leftRole, metric);
  const b = wclPerformanceMetricValue(right, rightRole, metric);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return descending ? b - a : a - b;
}
