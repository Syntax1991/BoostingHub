import type { CharacterRole, ParticipationType } from "@/models/enums";

export type RosterCompositionSlot = {
  selected: number;
  target: number;
  delta: number;
};

export type RosterComposition = {
  tanks: RosterCompositionSlot;
  healers: RosterCompositionSlot;
  dps: RosterCompositionSlot;
  lootbuddies: number;
  boosterTotal: number;
  total: number;
};

export type CompositionMember = {
  participationType: ParticipationType;
  role: CharacterRole | null;
};

function slot(selected: number, target: number): RosterCompositionSlot {
  return { selected, target, delta: selected - target };
}

/**
 * LOOT_ONLY and PLAYING lootbuddies are never counted as Tank/Healer/DPS.
 * PLAYING has no assigned booster role in Phase 2, so it stays in the lootbuddy bucket.
 */
export function composeRoster(
  selected: CompositionMember[],
  targets: { tanks: number; healers: number; dps: number },
): RosterComposition {
  const boosters = selected.filter((item) => item.participationType === "BOOSTER");
  const tanks = boosters.filter((item) => item.role === "TANK").length;
  const healers = boosters.filter((item) => item.role === "HEALER").length;
  const dps = boosters.filter((item) => item.role === "DPS").length;
  const lootbuddies = selected.filter((item) => item.participationType === "LOOTBUDDY").length;

  return {
    tanks: slot(tanks, targets.tanks),
    healers: slot(healers, targets.healers),
    dps: slot(dps, targets.dps),
    lootbuddies,
    boosterTotal: boosters.length,
    total: selected.length,
  };
}

export function compositionWarnings(composition: RosterComposition): Array<{ code: string; message: string }> {
  const warnings: Array<{ code: string; message: string }> = [];
  const roles = [
    ["Tank", composition.tanks],
    ["Healer", composition.healers],
    ["DPS", composition.dps],
  ] as const;

  for (const [label, slotValue] of roles) {
    if (slotValue.delta < 0) {
      warnings.push({
        code: "COMPOSITION_UNDER_TARGET",
        message: `${label} composition is ${slotValue.selected} / ${slotValue.target}.`,
      });
    }
    if (slotValue.delta > 0) {
      warnings.push({
        code: "COMPOSITION_OVER_TARGET",
        message: `${label} composition is ${slotValue.selected} / ${slotValue.target}.`,
      });
    }
  }

  return warnings;
}
