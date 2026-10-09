import { RAID_BUFF_DEFINITIONS, type RaidBuffId } from "@/services/roster-raid-buffs";

/**
 * Centralized soft-scoring weights for Roster Builder.
 * Soft scores never bypass hard eligibility / composition constraints.
 *
 * Soft ordering (via magnitudes; hard constraints always first):
 * 1. Distinct raid-utility coverage (first provider of each buff)
 * 2. Primary-role assignment preference
 * 3. Preferred-offspec assignment preference
 * 4. WarcraftLogs performance (modest for healers)
 * 5. Item level
 * 6. Stable name / signupId tie-break (outside numeric score)
 *
 * Primary weight (200) outranks max WCL (~100) + typical ilvl (~14), so a
 * tiny ilvl/WCL edge cannot routinely override main-role intent. Utility
 * (1000/buff) still outranks role preference.
 */

/** Soft weight for the first provider of each tracked raid buff. */
export const ROSTER_BUILDER_UTILITY_FIRST_WEIGHT = 1000;

/** Soft weight for duplicate providers of an already-covered buff. */
export const ROSTER_BUILDER_UTILITY_DUPLICATE_WEIGHT = 0;

/**
 * Soft bonus when the assigned role equals Character.primaryRole.
 * Dominates WCL + ilvl so main-role candidates outrank equivalent offspecs.
 */
export const ROSTER_BUILDER_PRIMARY_ROLE_WEIGHT = 200;

/**
 * Soft bonus when the assigned role is in Character.offspecRoles (not primary).
 * Below primary; above undeclared playable roles (0). Still soft — used only
 * when needed to fill composition or when no better primary match exists.
 */
export const ROSTER_BUILDER_OFFSPEC_ROLE_WEIGHT = 40;

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
