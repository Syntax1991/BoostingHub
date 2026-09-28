import {
  ENCHANTABLE_ARMOR_SLOTS,
  GEAR_SLOT,
  OFF_HAND_WEAPON_ONLY_CLASSES,
  RUNEFORGES,
  TEMPORARY_WEAPON_ENCHANTS,
  gearSlotLabel,
  isRuneforge,
} from "@/lib/wow-gear-catalog";
import type { WowClass } from "@/models/enums";

/**
 * Read-time rules for Gear Readiness (permanent enchants, gems) and the
 * weapon enhancement consumable. Pure: game data lives in
 * src/lib/wow-gear-catalog.ts, facts come from the stored audit snapshot.
 *
 * False-positive safety: a check only warns on affirmative evidence that
 * something is missing. Missing log data, an off-hand that may not be a
 * weapon, or a socket count the game data cannot explain is UNKNOWN.
 */

/** One equipped item as stored for one audited fight. */
export type GearItemFact = {
  fightId: string;
  slot: number;
  itemId: number;
  permanentEnchantId: number | null;
  temporaryEnchantId: number | null;
  gemCount: number;
  /** Null when unknown (the game data cannot explain the gems seen). */
  socketCount: number | null;
};

export type GearCheckStatus = "PASS" | "WARNING" | "NA" | "UNKNOWN";

export type OffHandKind = "WEAPON" | "NOT_A_WEAPON" | "UNKNOWN";

/**
 * Is the off-hand item a weapon? Only on evidence: a shield imbue says it is
 * not; a weapon enhancement or a permanent enchant (only weapons take one in
 * that slot) says it is; so does a class that can hold nothing else there.
 */
export function offHandKind(item: GearItemFact | undefined, wowClass: WowClass | null): OffHandKind | null {
  if (!item) return null;
  const temporary = item.temporaryEnchantId != null ? TEMPORARY_WEAPON_ENCHANTS[item.temporaryEnchantId] : undefined;
  if (temporary?.kind === "SHIELD") return "NOT_A_WEAPON";
  if (temporary || item.permanentEnchantId != null) return "WEAPON";
  if (wowClass && OFF_HAND_WEAPON_ONLY_CLASSES.has(wowClass)) return "WEAPON";
  return "UNKNOWN";
}

export type WeaponEnhancementResult =
  /** Oil / stone. */
  | "EXTERNAL"
  /** Shaman imbue, Lightsmith rite — replaces an oil. */
  | "CLASS_NATIVE"
  /** Death Knight Runeforge — the Death Knight's weapon enhancement. */
  | "RUNEFORGE"
  /** A temporary enchant the catalog does not know yet — present, so not missing. */
  | "OTHER"
  | "MISSING";

export type WeaponEnhancementRequirement = {
  /** NA: no weapon equipped. */
  status: GearCheckStatus;
  weapons: Array<{ slot: number; slotLabel: string; result: WeaponEnhancementResult; label: string }>;
  /** Off-hand not checked: not a weapon (shield / frill), or unknown whether it is. */
  skipped: Array<{ slot: number; slotLabel: string; reason: "NOT_A_WEAPON" | "UNKNOWN_IF_WEAPON" }>;
};

function weaponResult(item: GearItemFact): { result: WeaponEnhancementResult; label: string } {
  if (item.temporaryEnchantId != null) {
    const entry = TEMPORARY_WEAPON_ENCHANTS[item.temporaryEnchantId];
    if (!entry || entry.kind === "SHIELD") return { result: "OTHER", label: "Weapon enhancement" };
    return { result: entry.kind === "CLASS_NATIVE" ? "CLASS_NATIVE" : "EXTERNAL", label: entry.label };
  }
  // A Runeforge is Death Knight-only by id, so no class lookup is needed.
  if (isRuneforge(item.permanentEnchantId)) return { result: "RUNEFORGE", label: "Runeforge" };
  return { result: "MISSING", label: "Missing" };
}

/**
 * The expected weapon enhancement for one CombatantInfo snapshot, and whether
 * it is there. Accepted, per weapon: an oil or stone; the class's own imbue
 * (it takes the same temporary-enchant slot, so both never stack); or, for a
 * Death Knight, a Runeforge. Hero Talents never need to be interpreted: a
 * Lightsmith rite shows up as the weapon's temporary enchant itself.
 */
export function resolveWeaponEnhancementRequirement(input: {
  wowClass: WowClass | null;
  gear: GearItemFact[];
}): WeaponEnhancementRequirement {
  const bySlot = new Map(input.gear.map((item) => [item.slot, item]));
  const mainHand = bySlot.get(GEAR_SLOT.MAIN_HAND);
  if (!mainHand) return { status: "NA", weapons: [], skipped: [] };
  const weapons: WeaponEnhancementRequirement["weapons"] = [
    { slot: mainHand.slot, slotLabel: gearSlotLabel(mainHand.slot), ...weaponResult(mainHand) },
  ];
  const skipped: WeaponEnhancementRequirement["skipped"] = [];
  const offHand = bySlot.get(GEAR_SLOT.OFF_HAND);
  const offKind = offHandKind(offHand, input.wowClass);
  if (offHand && offKind === "WEAPON") {
    weapons.push({ slot: offHand.slot, slotLabel: gearSlotLabel(offHand.slot), ...weaponResult(offHand) });
  } else if (offHand) {
    skipped.push({
      slot: offHand.slot,
      slotLabel: gearSlotLabel(offHand.slot),
      reason: offKind === "NOT_A_WEAPON" ? "NOT_A_WEAPON" : "UNKNOWN_IF_WEAPON",
    });
  }
  return { status: weapons.some((row) => row.result === "MISSING") ? "WARNING" : "PASS", weapons, skipped };
}

export type EnchantCheck = {
  status: GearCheckStatus;
  enchanted: number;
  required: number;
  missing: Array<{ slot: number; slotLabel: string }>;
  /** Could not be judged (off-hand that may not be a weapon). */
  unknown: Array<{ slot: number; slotLabel: string }>;
  /** Runeforges counted as the weapon enchant. */
  runeforges: string[];
};

/**
 * Permanent enchants on every equipped enchantable slot (catalog: current
 * expansion) plus weapons. A Runeforge is the Death Knight's weapon enchant.
 * Which enchant is chosen is not judged — only that one is present.
 */
export function evaluateEnchants(input: { wowClass: WowClass | null; gear: GearItemFact[] | null }): EnchantCheck {
  const empty: EnchantCheck = { status: "UNKNOWN", enchanted: 0, required: 0, missing: [], unknown: [], runeforges: [] };
  if (!input.gear) return empty;
  const bySlot = new Map(input.gear.map((item) => [item.slot, item]));
  const required: GearItemFact[] = [];
  for (const slot of [...ENCHANTABLE_ARMOR_SLOTS, GEAR_SLOT.MAIN_HAND]) {
    const item = bySlot.get(slot);
    if (item) required.push(item);
  }
  const offHand = bySlot.get(GEAR_SLOT.OFF_HAND);
  const offKind = offHandKind(offHand, input.wowClass);
  const unknown = offHand && offKind === "UNKNOWN" ? [{ slot: offHand.slot, slotLabel: gearSlotLabel(offHand.slot) }] : [];
  if (offHand && offKind === "WEAPON") required.push(offHand);

  const missing = required
    .filter((item) => item.permanentEnchantId == null)
    .map((item) => ({ slot: item.slot, slotLabel: gearSlotLabel(item.slot) }));
  const runeforges = [
    ...new Set(required.filter((item) => isRuneforge(item.permanentEnchantId)).map((item) => RUNEFORGES[item.permanentEnchantId!]!)),
  ];
  return {
    status: required.length === 0 ? (unknown.length ? "UNKNOWN" : "NA") : missing.length > 0 ? "WARNING" : "PASS",
    enchanted: required.length - missing.length,
    required: required.length,
    missing,
    unknown,
    runeforges,
  };
}

export type GemCheck = {
  status: GearCheckStatus;
  filled: number;
  sockets: number;
  /** Items with at least one empty socket. */
  empty: Array<{ slot: number; slotLabel: string; emptySockets: number; sockets: number }>;
  /** Items whose socket count the game data cannot explain. */
  unknown: Array<{ slot: number; slotLabel: string }>;
};

/**
 * Every socket that actually exists on an equipped item must hold a gem.
 * No socket → nothing required; gem quality is not judged.
 */
export function evaluateGems(input: { gear: GearItemFact[] | null }): GemCheck {
  if (!input.gear) return { status: "UNKNOWN", filled: 0, sockets: 0, empty: [], unknown: [] };
  let filled = 0;
  let sockets = 0;
  const empty: GemCheck["empty"] = [];
  const unknown: GemCheck["unknown"] = [];
  for (const item of [...input.gear].sort((a, b) => a.slot - b.slot)) {
    if (item.socketCount == null) {
      unknown.push({ slot: item.slot, slotLabel: gearSlotLabel(item.slot) });
      continue;
    }
    if (item.socketCount === 0) continue;
    sockets += item.socketCount;
    filled += Math.min(item.gemCount, item.socketCount);
    if (item.gemCount < item.socketCount) {
      empty.push({
        slot: item.slot,
        slotLabel: gearSlotLabel(item.slot),
        emptySockets: item.socketCount - item.gemCount,
        sockets: item.socketCount,
      });
    }
  }
  const status: GearCheckStatus =
    empty.length > 0 ? "WARNING" : unknown.length > 0 ? "UNKNOWN" : sockets === 0 ? "NA" : "PASS";
  return { status, filled, sockets, empty, unknown };
}
