/**
 * Centralized consumable catalog for the Run Consumables Audit.
 *
 * Business logic reads categories, never individual spell ids. Adding a new
 * flask/potion (new rank, new season) is a data-only change here.
 *
 * Every id below is the Warcraft Logs `abilityGameID` (= in-game spell id)
 * observed in public Warcraft Logs reports for The Venomous Abyss (WCL zone
 * 53, Midnight Season 2) via the WCL v2 GraphQL API in September 2026:
 * `masterData.abilities` for names, `events(dataType: Casts)` +
 * `events(dataType: CombatantInfo)` for which specs use them, and
 * `CombatantInfo.auras` for the flasks active at pull. Ids that could not be
 * classified from that evidence are deliberately left out rather than guessed.
 */

export const CONSUMABLE_CATEGORIES = [
  "FLASK",
  "DAMAGE_POTION",
  "MANA_POTION",
  "HEALING_POTION",
  "HEALTHSTONE",
  "FOOD",
  "AUGMENT_RUNE",
  "VANTUS_RUNE",
] as const;

export type ConsumableCategory = (typeof CONSUMABLE_CATEGORIES)[number];

/**
 * How a category shows up in a combat log.
 * AURA_AT_PULL: an aura listed in the CombatantInfo snapshot taken at pull.
 * CAST: a cast event by the player.
 */
export type ConsumableEvidence = "AURA_AT_PULL" | "CAST";

export const CONSUMABLE_CATEGORY_EVIDENCE: Record<ConsumableCategory, ConsumableEvidence> = {
  FLASK: "AURA_AT_PULL",
  DAMAGE_POTION: "CAST",
  MANA_POTION: "CAST",
  HEALING_POTION: "CAST",
  HEALTHSTONE: "CAST",
  FOOD: "AURA_AT_PULL",
  AUGMENT_RUNE: "AURA_AT_PULL",
  VANTUS_RUNE: "AURA_AT_PULL",
};

export const CONSUMABLE_CATEGORY_LABELS: Record<ConsumableCategory, string> = {
  FLASK: "Flask",
  DAMAGE_POTION: "Damage Potion",
  MANA_POTION: "Mana Potion",
  HEALING_POTION: "Healing Potion",
  HEALTHSTONE: "Healthstone",
  FOOD: "Food",
  AUGMENT_RUNE: "Augment Rune",
  VANTUS_RUNE: "Vantus Rune",
};

export type ConsumableCatalogEntry = {
  category: ConsumableCategory;
  spellId: number;
  name: string;
  expansion: "MIDNIGHT" | "TWW" | "EVERGREEN";
};

export const CONSUMABLE_CATALOG: readonly ConsumableCatalogEntry[] = [
  // Flasks — CombatantInfo auras at pull.
  { category: "FLASK", spellId: 1235108, name: "Flask of the Magisters", expansion: "MIDNIGHT" },
  { category: "FLASK", spellId: 1235110, name: "Flask of the Blood Knights", expansion: "MIDNIGHT" },
  { category: "FLASK", spellId: 1235111, name: "Flask of the Shattered Sun", expansion: "MIDNIGHT" },
  { category: "FLASK", spellId: 1235057, name: "Flask of Thalassian Resistance", expansion: "MIDNIGHT" },
  // Previous-expansion flasks still grant a flask effect; they count as a flask.
  { category: "FLASK", spellId: 431971, name: "Flask of Tempered Aggression", expansion: "TWW" },
  { category: "FLASK", spellId: 431972, name: "Flask of Tempered Swiftness", expansion: "TWW" },
  { category: "FLASK", spellId: 431973, name: "Flask of Tempered Versatility", expansion: "TWW" },
  { category: "FLASK", spellId: 431974, name: "Flask of Tempered Mastery", expansion: "TWW" },
  { category: "FLASK", spellId: 432021, name: "Flask of Alchemical Chaos", expansion: "TWW" },
  { category: "FLASK", spellId: 432473, name: "Flask of Saving Graces", expansion: "TWW" },

  // Combat potions — cast events, keyed by the potion's USE spell (WCL abilityGameID),
  // never by item id. A Midnight Potion Cauldron's "Fleeting" potions cast the SAME
  // spell as the tradable potion (Blizzard ItemEffect): e.g. Light's Potential items
  // 241308/241309 and Fleeting 245897/245898 all cast 1236616, and Warcraft Logs shows
  // one ability for both — so one entry covers both variants.
  // Used by every Tank/DPS spec in the sample.
  { category: "DAMAGE_POTION", spellId: 1236994, name: "Potion of Recklessness", expansion: "MIDNIGHT" },
  // Primary-stat potion (items 241308/241309, Fleeting 245897/245898). 60 casts per
  // raid in the cauldron reports 6QX9gcpjNTMdBtVR / WV3BMCHnLvZfb9Yd.
  { category: "DAMAGE_POTION", spellId: 1236616, name: "Light's Potential", expansion: "MIDNIGHT" },
  // Damage-proc potion (items 241296/241297, Fleeting 245900/245901) — the fourth
  // Midnight combat potion; not seen in the sample logs yet, verified from game data.
  { category: "DAMAGE_POTION", spellId: 1238443, name: "Potion of Zealotry", expansion: "MIDNIGHT" },
  // Used by Tank/DPS specs (BM, Assassination, Subtlety, Elemental, Arcane, Arms, Prot Paladin, Unholy).
  { category: "DAMAGE_POTION", spellId: 1236998, name: "Draught of Rampant Abandon", expansion: "MIDNIGHT" },
  // Used only by healer specs (Resto Druid/Shaman, Disc/Holy Priest, MW, Pres) in the sample.
  { category: "MANA_POTION", spellId: 1236648, name: "Lightfused Mana Potion", expansion: "MIDNIGHT" },
  // Used only by healer specs (Resto Shaman, Holy/Disc Priest) in the sample.
  { category: "MANA_POTION", spellId: 1239479, name: "Potion of Devoured Dreams", expansion: "MIDNIGHT" },

  // Personal recovery.
  { category: "HEALING_POTION", spellId: 1234768, name: "Silvermoon Health Potion", expansion: "MIDNIGHT" },
  {
    category: "HEALING_POTION",
    spellId: 1295247,
    name: "Concentrated Silvermoon Health Potion",
    expansion: "MIDNIGHT",
  },
  { category: "HEALING_POTION", spellId: 1262857, name: "Potent Healing Potion", expansion: "MIDNIGHT" },
  { category: "HEALING_POTION", spellId: 431416, name: "Algari Healing Potion", expansion: "TWW" },
  { category: "HEALTHSTONE", spellId: 6262, name: "Healthstone", expansion: "EVERGREEN" },
  { category: "HEALTHSTONE", spellId: 452930, name: "Demonic Healthstone", expansion: "EVERGREEN" },
  // Augment rune buffs seen at pull in the same reports (≈12 % of players).
  { category: "AUGMENT_RUNE", spellId: 1234969, name: "Ethereal Augmentation", expansion: "MIDNIGHT" },
  { category: "AUGMENT_RUNE", spellId: 1242347, name: "Soulgorged Augmentation", expansion: "TWW" },
  { category: "AUGMENT_RUNE", spellId: 393438, name: "Draconic Augmentation", expansion: "EVERGREEN" },
];

/**
 * Food and Vantus Rune buffs come in dozens of ids (one per stat / boss) with
 * stable in-game names, so they are recognized by the aura name Warcraft Logs
 * reports: every food buff is "Well Fed" or "Hearty Well Fed" (91 % of 1 419
 * players at pull), every Vantus Rune buff "Vantus Rune: <boss>".
 */
const AURA_NAME_RULES: ReadonlyArray<{ category: ConsumableCategory; pattern: RegExp }> = [
  { category: "FOOD", pattern: /^(Hearty )?Well Fed$/i },
  { category: "VANTUS_RUNE", pattern: /^Vantus Rune:/i },
];

const BY_SPELL_ID = new Map<number, ConsumableCatalogEntry>(
  CONSUMABLE_CATALOG.map((entry) => [entry.spellId, entry]),
);

export function findConsumableBySpellId(spellId: number): ConsumableCatalogEntry | null {
  return BY_SPELL_ID.get(spellId) ?? null;
}

/** Catalog category of an aura active at pull: by id first, then by the stable in-game buff name. */
export function classifyPullAura(aura: { id: number; name: string | null }): ConsumableCategory | null {
  const entry = BY_SPELL_ID.get(aura.id);
  if (entry && CONSUMABLE_CATEGORY_EVIDENCE[entry.category] === "AURA_AT_PULL") return entry.category;
  const name = aura.name?.trim();
  if (!name) return null;
  return AURA_NAME_RULES.find((rule) => rule.pattern.test(name))?.category ?? null;
}

export function consumableSpellIds(evidence: ConsumableEvidence): number[] {
  return CONSUMABLE_CATALOG.filter(
    (entry) => CONSUMABLE_CATEGORY_EVIDENCE[entry.category] === evidence,
  ).map((entry) => entry.spellId);
}

export function isConsumableCategory(value: unknown): value is ConsumableCategory {
  return typeof value === "string" && (CONSUMABLE_CATEGORIES as readonly string[]).includes(value);
}
