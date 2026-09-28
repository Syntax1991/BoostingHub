import type { WowClass } from "@/models/enums";

/**
 * Game data for the Gear Readiness and weapon-enhancement checks — no
 * evaluation logic (see src/services/gear-readiness-policy.ts). Enchant ids are
 * SpellItemEnchantment ids exactly as Warcraft Logs reports them in
 * CombatantInfo `gear[].permanentEnchant` / `temporaryEnchant`; names are from
 * the client game data (DB2, build 12.1.5).
 */

/**
 * Warcraft Logs CombatantInfo `gear` is an 18-entry array whose position is
 * the equipment slot.
 */
export const GEAR_SLOT = {
  HEAD: 0,
  NECK: 1,
  SHOULDERS: 2,
  SHIRT: 3,
  CHEST: 4,
  WAIST: 5,
  LEGS: 6,
  FEET: 7,
  WRISTS: 8,
  HANDS: 9,
  RING_1: 10,
  RING_2: 11,
  TRINKET_1: 12,
  TRINKET_2: 13,
  BACK: 14,
  MAIN_HAND: 15,
  OFF_HAND: 16,
  TABARD: 17,
} as const;

export type GearSlotIndex = (typeof GEAR_SLOT)[keyof typeof GEAR_SLOT];

export const GEAR_SLOT_LABELS: Record<number, string> = {
  0: "Head",
  1: "Neck",
  2: "Shoulders",
  3: "Shirt",
  4: "Chest",
  5: "Waist",
  6: "Legs",
  7: "Feet",
  8: "Wrists",
  9: "Hands",
  10: "Ring 1",
  11: "Ring 2",
  12: "Trinket 1",
  13: "Trinket 2",
  14: "Back",
  15: "Main Hand",
  16: "Off Hand",
  17: "Tabard",
};

export function gearSlotLabel(slot: number): string {
  return GEAR_SLOT_LABELS[slot] ?? `Slot ${slot}`;
}

/**
 * Slots that take a permanent enchant in the current expansion (Midnight).
 * Evidence: 1 419 players in 75 public Venomous Abyss reports — these slots
 * carry an enchant 80–93 % of the time, every other slot 0 %. The off-hand
 * counts only when it holds a weapon (a shield or off-hand frill takes none).
 * Update with the expansion's enchanting recipes.
 */
export const ENCHANTABLE_ARMOR_SLOTS: readonly number[] = [
  GEAR_SLOT.HEAD,
  GEAR_SLOT.SHOULDERS,
  GEAR_SLOT.CHEST,
  GEAR_SLOT.LEGS,
  GEAR_SLOT.FEET,
  GEAR_SLOT.RING_1,
  GEAR_SLOT.RING_2,
];
export const WEAPON_SLOTS: readonly number[] = [GEAR_SLOT.MAIN_HAND, GEAR_SLOT.OFF_HAND];

/**
 * Classes whose off-hand can only ever be a weapon (they cannot equip a
 * shield or an off-hand frill), so an off-hand item is a weapon even without
 * any enchant on it. For other classes the off-hand is only treated as a
 * weapon on evidence (a weapon enchant or weapon enhancement on it).
 */
export const OFF_HAND_WEAPON_ONLY_CLASSES: ReadonlySet<WowClass> = new Set([
  "ROGUE",
  "DEMON_HUNTER",
  "DEATH_KNIGHT",
]);

export type WeaponEnhancementKind =
  /** Oil / sharpening stone / weightstone — any class. */
  | "EXTERNAL"
  /** A class ability that occupies the weapon's temporary enchant (Shaman imbue, Lightsmith rite). */
  | "CLASS_NATIVE"
  /** Applied to a shield, not a weapon (Shaman shield imbues). */
  | "SHIELD";

export type WeaponEnhancementEntry = {
  kind: WeaponEnhancementKind;
  name: string;
  /** Short label for the audit matrix. */
  label: string;
  /** CLASS_NATIVE / SHIELD: the class that has it. */
  wowClass?: WowClass;
};

/**
 * Temporary weapon enchants (`gear[].temporaryEnchant`). Class-native imbues
 * use the same single temporary-enchant slot as an oil — the game never
 * stacks both on one weapon — so either satisfies the weapon enhancement.
 */
export const TEMPORARY_WEAPON_ENCHANTS: Readonly<Record<number, WeaponEnhancementEntry>> = {
  8051: { kind: "EXTERNAL", name: "Thalassian Phoenix Oil", label: "Oil" },
  8052: { kind: "EXTERNAL", name: "Thalassian Phoenix Oil", label: "Oil" },
  8054: { kind: "EXTERNAL", name: "Oil of Dawn", label: "Oil" },
  7905: { kind: "EXTERNAL", name: "Sharpened (whetstone)", label: "Stone" },
  7906: { kind: "EXTERNAL", name: "Sharpened (whetstone)", label: "Stone" },
  5400: { kind: "CLASS_NATIVE", name: "Flametongue Weapon", label: "Shaman imbue", wowClass: "SHAMAN" },
  5401: { kind: "CLASS_NATIVE", name: "Windfury Weapon", label: "Shaman imbue", wowClass: "SHAMAN" },
  6498: { kind: "CLASS_NATIVE", name: "Earthliving Weapon", label: "Shaman imbue", wowClass: "SHAMAN" },
  // Lightsmith (Holy / Protection Paladin Hero Talent) — the rite is the imbue.
  7143: { kind: "CLASS_NATIVE", name: "Rite of Sanctification", label: "Lightsmith rite", wowClass: "PALADIN" },
  7144: { kind: "CLASS_NATIVE", name: "Rite of Adjuration", label: "Lightsmith rite", wowClass: "PALADIN" },
  7528: { kind: "SHIELD", name: "Tidecaller's Guard", label: "Shield imbue", wowClass: "SHAMAN" },
  7587: { kind: "SHIELD", name: "Thunderstrike Ward", label: "Shield imbue", wowClass: "SHAMAN" },
};

/** Classes whose required weapon enhancement is a Runeforge (an oil is optional for them). */
export const RUNEFORGE_CLASSES: ReadonlySet<WowClass> = new Set(["DEATH_KNIGHT"]);

/**
 * Death Knight Runeforges — the Death Knight's permanent weapon enchant
 * (`gear[].permanentEnchant`). A Runeforged weapon counts as enchanted, and as
 * the weapon's enhancement: a Death Knight is never asked for an oil on top.
 */
export const RUNEFORGES: Readonly<Record<number, string>> = {
  3366: "Rune of Lichbane",
  3368: "Rune of the Fallen Crusader",
  3370: "Rune of Razorice",
  3847: "Rune of the Stoneskin Gargoyle",
  6241: "Rune of Sanguination",
  6242: "Rune of Spellwarding",
  6243: "Rune of Hysteria",
  6244: "Rune of Unending Thirst",
  6245: "Rune of the Apocalypse",
};

export function isRuneforge(enchantId: number | null): boolean {
  return enchantId != null && enchantId in RUNEFORGES;
}
