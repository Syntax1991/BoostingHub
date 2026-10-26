import { classifyRunWeek } from "@/lib/wow-run-week";

/**
 * Raid-ID week filter shared by /runs and /my-runs (`?id=`). The window
 * itself is never computed here: `classifyRunWeek` owns the product's
 * Wednesday 06:00 Europe/Berlin boundary (DST-safe, half-open windows), so
 * both pages always agree on what "Current ID" means.
 */
export const RAID_ID_FILTERS = ["current", "next", "all"] as const;

export type RaidIdFilter = (typeof RAID_ID_FILTERS)[number];

export const DEFAULT_RAID_ID_FILTER: RaidIdFilter = "current";

export const RAID_ID_FILTER_LABELS: Record<RaidIdFilter, string> = {
  current: "Current ID",
  next: "Next ID",
  all: "All",
};

/** Missing, repeated or unknown `?id=` values fall back to Current ID. */
export function resolveRaidIdFilter(value: string | string[] | undefined): RaidIdFilter {
  return RAID_ID_FILTERS.find((filter) => filter === value) ?? DEFAULT_RAID_ID_FILTER;
}

/**
 * Whether a Run's scheduled start belongs to the chosen raid-ID window. Current
 * ID is the whole active window — an earlier, already completed Run of the same
 * ID still belongs to it (status filters stay independent).
 */
export function matchesRaidIdFilter(
  scheduledStartAt: string,
  filter: RaidIdFilter,
  now: Date = new Date(),
): boolean {
  if (filter === "all") return true;
  const { bucket } = classifyRunWeek({ scheduledStartAt, now });
  return filter === "current" ? bucket === "CURRENT" : bucket === "NEXT";
}

/** `?id=` value for a link; Current ID is the default and left out. */
export function raidIdSearchParam(filter: RaidIdFilter): string | null {
  return filter === DEFAULT_RAID_ID_FILTER ? null : filter;
}
