import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";
import {
  filterWclPerformanceForGroupRole,
  formatWclPerformanceTooltip,
  wclPerformanceMetricValue,
  wclPercentileColor,
} from "@/lib/wcl-performance-display";
import type { CharacterRole } from "@/models/enums";

export type SignupTileWclChoice = {
  name: string;
  role: CharacterRole;
};

/**
 * Compact Signup-tile Best percentile.
 * Selected/alternate spec → that spec's Best. Single offered → that Best.
 * Undrafted multi-spec → peak across offered specs (never invents a primary).
 * Quiet when no cached percentiles exist.
 */
export function resolveSignupTileWclBest(input: {
  segments: WclPerformanceRaidSegment[];
  offeredSpecs: readonly SignupTileWclChoice[];
  selected: boolean;
  assignedRole: CharacterRole | null;
  assignedSpec: string | null;
}): { bestPct: number | null; specName: string | null; role: CharacterRole | null; tooltip: string | null } {
  const { segments, offeredSpecs, selected, assignedRole, assignedSpec } = input;
  if (segments.length === 0) {
    return { bestPct: null, specName: null, role: null, tooltip: null };
  }

  if (selected && assignedSpec) {
    const role =
      assignedRole ?? offeredSpecs.find((spec) => spec.name === assignedSpec)?.role ?? null;
    if (!role) return { bestPct: null, specName: null, role: null, tooltip: null };
    const bestPct = wclBestForSpec(segments, role, assignedSpec);
    return {
      bestPct,
      specName: assignedSpec,
      role,
      tooltip: bestPct != null ? formatWclSpecTooltip(segments, role, assignedSpec) : null,
    };
  }

  if (offeredSpecs.length === 1) {
    const only = offeredSpecs[0]!;
    const bestPct = wclBestForSpec(segments, only.role, only.name);
    return {
      bestPct,
      specName: only.name,
      role: only.role,
      tooltip: bestPct != null ? formatWclSpecTooltip(segments, only.role, only.name) : null,
    };
  }

  if (offeredSpecs.length > 1) {
    let peak: number | null = null;
    for (const spec of offeredSpecs) {
      const value = wclBestForSpec(segments, spec.role, spec.name);
      if (value == null) continue;
      if (peak == null || value > peak) peak = value;
    }
    return {
      bestPct: peak,
      specName: null,
      role: null,
      tooltip: peak != null ? formatWclPerformanceTooltip(segments, null) : null,
    };
  }

  // No offered-spec catalog — role-scoped peak, else any cached Best.
  const bestPct = wclPerformanceMetricValue(segments, assignedRole, "best");
  return {
    bestPct,
    specName: null,
    role: assignedRole,
    tooltip: bestPct != null ? formatWclPerformanceTooltip(segments, assignedRole) : null,
  };
}

function peakForMetric(
  segments: WclPerformanceRaidSegment[],
  role: CharacterRole,
  specName: string | null,
  metric: "best" | "avg",
): number | null {
  const scoped = filterWclPerformanceForGroupRole(segments, role);
  let peak: number | null = null;
  for (const segment of scoped) {
    for (const row of segment.roles) {
      if (specName) {
        const label = row.specLabel?.trim().toLocaleLowerCase("en-US") ?? "";
        if (label && label !== specName.trim().toLocaleLowerCase("en-US")) continue;
      }
      const value = metric === "best" ? row.bestPct : row.avgPct;
      if (value == null || !Number.isFinite(value)) continue;
      if (peak == null || value > peak) peak = value;
    }
  }
  // Spec label miss: fall back to role peak (cached data may omit specLabel).
  if (peak == null && specName) {
    return peakForMetric(segments, role, null, metric);
  }
  return peak;
}

/** Best percentile for a concrete role + optional specialization label. */
export function wclBestForSpec(
  segments: WclPerformanceRaidSegment[],
  role: CharacterRole,
  specName: string | null,
): number | null {
  return peakForMetric(segments, role, specName, "best");
}

/** Average percentile for a concrete role + optional specialization label. */
export function wclAvgForSpec(
  segments: WclPerformanceRaidSegment[],
  role: CharacterRole,
  specName: string | null,
): number | null {
  return peakForMetric(segments, role, specName, "avg");
}

export function formatWclSpecChip(pct: number | null): { text: string; color: string } | null {
  if (pct == null) return null;
  return {
    text: Number.isInteger(pct) ? String(pct) : pct.toFixed(0),
    color: wclPercentileColor(pct),
  };
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(0);
}

/**
 * Hover/focus tooltip for the visible Best link — spec, raid, Best, Average.
 * Never invents percentiles; empty when no cached data for that spec.
 */
export function formatWclSpecTooltip(
  segments: WclPerformanceRaidSegment[],
  role: CharacterRole,
  specName: string,
): string | null {
  const scoped = filterWclPerformanceForGroupRole(segments, role);
  const blocks: string[] = [];
  for (const segment of scoped) {
    for (const row of segment.roles) {
      const label = row.specLabel?.trim().toLocaleLowerCase("en-US") ?? "";
      if (label && label !== specName.trim().toLocaleLowerCase("en-US")) continue;
      if (row.bestPct == null && row.avgPct == null) continue;
      const lines = [specName, segment.raidName];
      if (row.bestPct != null) lines.push(`Best: ${formatPct(row.bestPct)}`);
      if (row.avgPct != null) lines.push(`Average: ${formatPct(row.avgPct)}`);
      blocks.push(lines.join("\n"));
    }
  }
  if (blocks.length === 0) {
    // Role-only rows without matching specLabel still show when this is the sole role row.
    const best = wclBestForSpec(segments, role, specName);
    const avg = wclAvgForSpec(segments, role, specName);
    if (best == null && avg == null) return null;
    const lines = [specName];
    if (scoped[0]?.raidName) lines.push(scoped[0].raidName);
    if (best != null) lines.push(`Best: ${formatPct(best)}`);
    if (avg != null) lines.push(`Average: ${formatPct(avg)}`);
    return lines.join("\n");
  }
  return blocks.join("\n\n");
}
