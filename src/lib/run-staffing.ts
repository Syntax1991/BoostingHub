import type { CharacterRole, ParticipationType, RunStatus, SignupStatus } from "@/models/enums";
import { composeRoster, type CompositionMember } from "@/services/roster-composition";
import { isActiveSignupOffer } from "@/services/signup-state";

export type RunStaffingDesired = {
  tanks: number;
  healers: number;
  dps: number;
  lootbuddies: number;
};

export type RunStaffedCounts = {
  tanks: number;
  healers: number;
  meleeDps: number;
  rangedDps: number;
  /** Aggregate DPS = MELEE_DPS + RANGED_DPS (generic DPS does not count). */
  dps: number;
  lootbuddies: number;
};

export type RunStaffingShortage = {
  tanks: number;
  healers: number;
  dps: number;
  lootbuddies: number;
};

export type RunStaffingProjection = {
  status: "FULLY_STAFFED" | "NEEDS_STAFFING";
  desired: RunStaffingDesired;
  staffed: RunStaffedCounts;
  missing: RunStaffingShortage;
  overstaffed: RunStaffingShortage;
};

export type RosterPickSource = {
  status: RunStatus;
  signups: Array<{
    id: string;
    status: SignupStatus;
    participationType: ParticipationType;
    publishedRole: CharacterRole | null;
  }>;
  roster: {
    selections: Array<{
      signupId: string;
      selected: boolean;
      selectedRole: CharacterRole | null;
    }>;
    externalBoosters: Array<{
      participationType: ParticipationType;
      role: CharacterRole | null;
    }>;
  } | null;
};

/**
 * Same pick authority as Discord signup/roster embeds:
 * pre-PUBLISHED → saved draft selections (+ active offers);
 * PUBLISHED / IN_PROGRESS / COMPLETED → live SELECTED + publishedRole.
 * External boosters always count when present on the roster.
 */
export function selectedRosterMembersForStaffing(run: RosterPickSource): CompositionMember[] {
  const usePublishedPicks =
    run.status === "PUBLISHED" || run.status === "IN_PROGRESS" || run.status === "COMPLETED";
  const byId = new Map(run.signups.map((signup) => [signup.id, signup]));
  const members: CompositionMember[] = [];

  if (usePublishedPicks) {
    for (const signup of run.signups) {
      if (signup.status !== "SELECTED") continue;
      members.push({
        participationType: signup.participationType,
        selectedRole:
          signup.participationType === "LOOTBUDDY" ? null : signup.publishedRole,
      });
    }
  } else {
    for (const selection of run.roster?.selections ?? []) {
      if (!selection.selected) continue;
      const signup = byId.get(selection.signupId);
      if (!signup || !isActiveSignupOffer(signup.status)) continue;
      members.push({
        participationType: signup.participationType,
        selectedRole:
          signup.participationType === "LOOTBUDDY" ? null : selection.selectedRole,
      });
    }
  }

  for (const booster of run.roster?.externalBoosters ?? []) {
    members.push({
      participationType: booster.participationType,
      selectedRole: booster.participationType === "LOOTBUDDY" ? null : booster.role,
    });
  }

  return members;
}

/**
 * Pure staffing projection for Schedule overlay / operational summaries.
 * Desired comes from the caller (Run snapshot for materialized; never live template).
 * Missing never goes negative; overstaffing is separate from shortages.
 */
export function projectRunStaffing(input: {
  desired: RunStaffingDesired;
  selectedRoster: CompositionMember[];
}): RunStaffingProjection {
  const composition = composeRoster(input.selectedRoster, {
    tanks: input.desired.tanks,
    healers: input.desired.healers,
    dps: input.desired.dps,
    lootbuddies: input.desired.lootbuddies,
  });

  const boosters = input.selectedRoster.filter((row) => row.participationType === "BOOSTER");
  const meleeDps = boosters.filter((row) => row.selectedRole === "MELEE_DPS").length;
  const rangedDps = boosters.filter((row) => row.selectedRole === "RANGED_DPS").length;

  const missing: RunStaffingShortage = {
    tanks: Math.max(0, -composition.tanks.delta),
    healers: Math.max(0, -composition.healers.delta),
    dps: Math.max(0, -composition.dps.delta),
    lootbuddies: Math.max(0, -composition.lootbuddies.delta),
  };
  const overstaffed: RunStaffingShortage = {
    tanks: Math.max(0, composition.tanks.delta),
    healers: Math.max(0, composition.healers.delta),
    dps: Math.max(0, composition.dps.delta),
    lootbuddies: Math.max(0, composition.lootbuddies.delta),
  };

  const needsStaffing =
    missing.tanks > 0 || missing.healers > 0 || missing.dps > 0 || missing.lootbuddies > 0;

  return {
    status: needsStaffing ? "NEEDS_STAFFING" : "FULLY_STAFFED",
    desired: {
      tanks: input.desired.tanks,
      healers: input.desired.healers,
      dps: input.desired.dps,
      lootbuddies: input.desired.lootbuddies,
    },
    staffed: {
      tanks: composition.tanks.selected,
      healers: composition.healers.selected,
      meleeDps,
      rangedDps,
      dps: composition.dps.selected,
      lootbuddies: composition.lootbuddies.selected,
    },
    missing,
    overstaffed,
  };
}

export function projectRunStaffingFromRun(run: RosterPickSource & RunStaffingDesiredSource): RunStaffingProjection {
  return projectRunStaffing({
    desired: {
      tanks: run.desiredTankCount,
      healers: run.desiredHealerCount,
      dps: run.desiredDpsCount,
      lootbuddies: run.desiredLootbuddyCount,
    },
    selectedRoster: selectedRosterMembersForStaffing(run),
  });
}

export type RunStaffingDesiredSource = {
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
};

/** Compact composition line: `2T · 4H · 14D · 3LB` */
export function formatCompositionCounts(counts: {
  tanks: number;
  healers: number;
  dps: number;
  lootbuddies: number;
}): string {
  return `${counts.tanks}T · ${counts.healers}H · ${counts.dps}D · ${counts.lootbuddies}LB`;
}

/** Shortage line only (empty when fully staffed). */
export function formatMissingCounts(missing: RunStaffingShortage): string {
  const parts: string[] = [];
  if (missing.tanks > 0) parts.push(`${missing.tanks}T`);
  if (missing.healers > 0) parts.push(`${missing.healers}H`);
  if (missing.dps > 0) parts.push(`${missing.dps}D`);
  if (missing.lootbuddies > 0) parts.push(`${missing.lootbuddies}LB`);
  return parts.join(" · ");
}
