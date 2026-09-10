import type { WowClass } from "@/models/enums";

/**
 * Blizzard playable_class.id → BoostingHub WowClass.
 * IDs are stable retail Game Data identifiers (1–13).
 */
const PLAYABLE_CLASS_BY_ID: Readonly<Record<number, WowClass>> = {
  1: "WARRIOR",
  2: "PALADIN",
  3: "HUNTER",
  4: "ROGUE",
  5: "PRIEST",
  6: "DEATH_KNIGHT",
  7: "SHAMAN",
  8: "MAGE",
  9: "WARLOCK",
  10: "MONK",
  11: "DRUID",
  12: "DEMON_HUNTER",
  13: "EVOKER",
};

export function mapPlayableClassId(id: number): WowClass | null {
  return PLAYABLE_CLASS_BY_ID[id] ?? null;
}

export function requirePlayableClassId(id: number): WowClass {
  const mapped = mapPlayableClassId(id);
  if (!mapped) {
    throw new Error(`Unknown Blizzard playable_class id: ${id}`);
  }
  return mapped;
}
