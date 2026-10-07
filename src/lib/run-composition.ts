import { DomainError } from "@/lib/errors";
import { assertComposition } from "@/services/run-state";

/** Default or Schedule-override composition snapshotted onto a concrete Run. */
export type EffectiveRunComposition = {
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
};

export type CompositionSourceTemplate = {
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
};

export type CompositionSourceScheduleSlot = {
  compositionOverrideEnabled: boolean;
  desiredTankCountOverride: number | null;
  desiredHealerCountOverride: number | null;
  desiredDpsCountOverride: number | null;
  desiredLootbuddyCountOverride: number | null;
};

/**
 * Single authority for Run composition at materialization / create time.
 *
 * Override OFF → live RunTemplate defaults.
 * Override ON → complete Schedule override (all four counts required).
 */
export function resolveEffectiveRunComposition(input: {
  template: CompositionSourceTemplate;
  scheduleSlot?: CompositionSourceScheduleSlot | null;
}): EffectiveRunComposition {
  const slot = input.scheduleSlot;
  if (slot?.compositionOverrideEnabled) {
    const tanks = slot.desiredTankCountOverride;
    const healers = slot.desiredHealerCountOverride;
    const dps = slot.desiredDpsCountOverride;
    const lootbuddies = slot.desiredLootbuddyCountOverride;
    if (tanks == null || healers == null || dps == null || lootbuddies == null) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Custom Schedule composition requires tanks, healers, DPS, and lootbuddies.",
      );
    }
    assertComposition(tanks, "Desired tanks");
    assertComposition(healers, "Desired healers");
    assertComposition(dps, "Desired DPS");
    assertComposition(lootbuddies, "Desired lootbuddies");
    return {
      desiredTankCount: tanks,
      desiredHealerCount: healers,
      desiredDpsCount: dps,
      desiredLootbuddyCount: lootbuddies,
    };
  }

  const composition: EffectiveRunComposition = {
    desiredTankCount: input.template.desiredTankCount,
    desiredHealerCount: input.template.desiredHealerCount,
    desiredDpsCount: input.template.desiredDpsCount,
    desiredLootbuddyCount: input.template.desiredLootbuddyCount ?? 0,
  };
  assertComposition(composition.desiredTankCount, "Desired tanks");
  assertComposition(composition.desiredHealerCount, "Desired healers");
  assertComposition(composition.desiredDpsCount, "Desired DPS");
  assertComposition(composition.desiredLootbuddyCount, "Desired lootbuddies");
  return composition;
}

/** Normalize Schedule write input: inherit clears overrides; custom requires all four. */
export function normalizeScheduleCompositionWrite(input: {
  compositionOverrideEnabled?: boolean | null;
  desiredTankCountOverride?: number | null;
  desiredHealerCountOverride?: number | null;
  desiredDpsCountOverride?: number | null;
  desiredLootbuddyCountOverride?: number | null;
}): CompositionSourceScheduleSlot {
  if (!input.compositionOverrideEnabled) {
    return {
      compositionOverrideEnabled: false,
      desiredTankCountOverride: null,
      desiredHealerCountOverride: null,
      desiredDpsCountOverride: null,
      desiredLootbuddyCountOverride: null,
    };
  }
  const tanks = input.desiredTankCountOverride;
  const healers = input.desiredHealerCountOverride;
  const dps = input.desiredDpsCountOverride;
  const lootbuddies = input.desiredLootbuddyCountOverride ?? 0;
  if (tanks == null || healers == null || dps == null) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Custom Schedule composition requires tanks, healers, DPS, and lootbuddies.",
    );
  }
  assertComposition(tanks, "Desired tanks");
  assertComposition(healers, "Desired healers");
  assertComposition(dps, "Desired DPS");
  assertComposition(lootbuddies, "Desired lootbuddies");
  return {
    compositionOverrideEnabled: true,
    desiredTankCountOverride: tanks,
    desiredHealerCountOverride: healers,
    desiredDpsCountOverride: dps,
    desiredLootbuddyCountOverride: lootbuddies,
  };
}
