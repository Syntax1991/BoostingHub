import { RAID_BUFF_DEFINITIONS, type RaidBuffId } from "@/services/roster-raid-buffs";

/**
 * Centralized soft-scoring weights for Roster Builder.
 * Soft scores never bypass hard eligibility / composition constraints.
 *
 * Priority (lexicographic via large utility magnitudes):
 * 1. Distinct raid-utility coverage (first provider of each buff)
 * 2. WarcraftLogs performance (modest for healers)
 * 3. Item level
 * 4. Stable name / signupId tie-break (outside numeric score)
 */

/** Soft weight for the first provider of each tracked raid buff. */
export const ROSTER_BUILDER_UTILITY_FIRST_WEIGHT = 1000;

/** Soft weight for duplicate providers of an already-covered buff. */
export const ROSTER_BUILDER_UTILITY_DUPLICATE_WEIGHT = 0;

/** Soft WCL weight for tanks and DPS (applied to 0..100 percentile). */
export const ROSTER_BUILDER_WCL_WEIGHT = 1;

/**
 * Soft WCL weight for healers. Raw HPS percentiles are encounter-dependent;
 * keep well below structural utility / staffing needs.
 */
export const ROSTER_BUILDER_WCL_HEALER_WEIGHT = 0.35;

/** Soft item-level weight (ilvl typically ~300–700). */
export const ROSTER_BUILDER_ILVL_WEIGHT = 0.02;

/** Prefer avg percentile when present; else best. */
export type RosterBuilderWclMetricPreference = "avg_then_best";

export const ROSTER_BUILDER_WCL_METRIC: RosterBuilderWclMetricPreference = "avg_then_best";

/** Per-buff importance — currently uniform; keep explicit for future tuning. */
export const ROSTER_BUILDER_BUFF_IMPORTANCE: Readonly<Record<RaidBuffId, number>> = Object.freeze(
  Object.fromEntries(
    RAID_BUFF_DEFINITIONS.map((definition) => [definition.id, ROSTER_BUILDER_UTILITY_FIRST_WEIGHT]),
  ) as Record<RaidBuffId, number>,
);
