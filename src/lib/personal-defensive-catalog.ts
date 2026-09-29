import type { WowClass } from "@/models/enums";

/**
 * Active PERSONAL defensive cooldowns for the Survival section of the Run
 * Consumables Audit. Only buttons a player presses for their OWN survival —
 * never throughput / offensive cooldowns, mobility, utility, raid or external
 * defensives (Pain Suppression, Ironbark, Blessing of Protection, …).
 *
 * Every id is the Warcraft Logs `abilityGameID` (= spell id) of the player's
 * own cast, taken from real Midnight raid logs (16 Venomous Abyss reports incl.
 * production report WV3BMCHnLvZfb9Yd, September 2026: `events(dataType: Casts)`
 * filtered by ability name, caster class/spec from `masterData.actors`) and
 * cross-checked against the game's SpellName table. Looked for but not seen in
 * those logs — and therefore left out rather than guessed: Rune Tap,
 * Netherwalk, Renewal, Renewing Blaze, Ice Block (Ice Cold replaces it),
 * Blazing Barrier, Diffuse Magic, Dampen Harm, Celestial Brew, Zen Meditation,
 * Shield of Vengeance, Eye of Tyr, Stone Bulwark Totem, Enraged Regeneration,
 * Last Stand, Bitter Immunity. Deliberately excluded: Lay on Hands (mostly cast
 * on OTHER players — the audit only knows the caster), Havoc Metamorphosis
 * (200166, offensive), Fade (threat utility), secondary events of one use
 * (Greater Invisibility 110960, Alter Time return 342247).
 *
 * `specs` is information only: a logged cast already proves the player had it.
 */
export type PersonalDefensiveKind = "MITIGATION" | "IMMUNITY" | "ABSORB" | "SELF_HEAL_MAJOR";

export type PersonalDefensiveEntry = {
  spellId: number;
  name: string;
  wowClass: WowClass;
  specs?: readonly string[];
  kind: PersonalDefensiveKind;
};

/** Observation category of a personal defensive CAST fact (text column — no enum migration). */
export const PERSONAL_DEFENSIVE_CATEGORY = "PERSONAL_DEFENSIVE";

export const PERSONAL_DEFENSIVE_KIND_LABELS: Record<PersonalDefensiveKind, string> = {
  MITIGATION: "Damage reduction",
  IMMUNITY: "Immunity",
  ABSORB: "Absorb",
  SELF_HEAL_MAJOR: "Self-heal",
};

export const PERSONAL_DEFENSIVE_CATALOG: readonly PersonalDefensiveEntry[] = [
  { spellId: 48707, name: "Anti-Magic Shell", wowClass: "DEATH_KNIGHT", kind: "ABSORB" },
  { spellId: 48792, name: "Icebound Fortitude", wowClass: "DEATH_KNIGHT", kind: "MITIGATION" },
  { spellId: 49039, name: "Lichborne", wowClass: "DEATH_KNIGHT", kind: "SELF_HEAL_MAJOR" },
  { spellId: 48743, name: "Death Pact", wowClass: "DEATH_KNIGHT", kind: "SELF_HEAL_MAJOR" },
  { spellId: 55233, name: "Vampiric Blood", wowClass: "DEATH_KNIGHT", specs: ["Blood"], kind: "MITIGATION" },

  { spellId: 198589, name: "Blur", wowClass: "DEMON_HUNTER", kind: "MITIGATION" },
  { spellId: 187827, name: "Metamorphosis", wowClass: "DEMON_HUNTER", specs: ["Vengeance"], kind: "MITIGATION" },
  { spellId: 204021, name: "Fiery Brand", wowClass: "DEMON_HUNTER", specs: ["Vengeance"], kind: "MITIGATION" },

  { spellId: 22812, name: "Barkskin", wowClass: "DRUID", kind: "MITIGATION" },
  { spellId: 61336, name: "Survival Instincts", wowClass: "DRUID", kind: "MITIGATION" },
  { spellId: 22842, name: "Frenzied Regeneration", wowClass: "DRUID", kind: "SELF_HEAL_MAJOR" },

  { spellId: 363916, name: "Obsidian Scales", wowClass: "EVOKER", kind: "MITIGATION" },

  { spellId: 186265, name: "Aspect of the Turtle", wowClass: "HUNTER", kind: "IMMUNITY" },
  { spellId: 264735, name: "Survival of the Fittest", wowClass: "HUNTER", kind: "MITIGATION" },
  { spellId: 109304, name: "Exhilaration", wowClass: "HUNTER", kind: "SELF_HEAL_MAJOR" },

  { spellId: 414658, name: "Ice Cold", wowClass: "MAGE", kind: "MITIGATION" },
  { spellId: 235450, name: "Prismatic Barrier", wowClass: "MAGE", specs: ["Arcane"], kind: "ABSORB" },
  { spellId: 11426, name: "Ice Barrier", wowClass: "MAGE", specs: ["Frost"], kind: "ABSORB" },
  { spellId: 55342, name: "Mirror Image", wowClass: "MAGE", kind: "MITIGATION" },
  { spellId: 110959, name: "Greater Invisibility", wowClass: "MAGE", kind: "MITIGATION" },
  { spellId: 342245, name: "Alter Time", wowClass: "MAGE", kind: "SELF_HEAL_MAJOR" },

  { spellId: 115203, name: "Fortifying Brew", wowClass: "MONK", kind: "MITIGATION" },
  { spellId: 122470, name: "Touch of Karma", wowClass: "MONK", specs: ["Windwalker"], kind: "ABSORB" },
  { spellId: 1241059, name: "Celestial Infusion", wowClass: "MONK", specs: ["Brewmaster"], kind: "ABSORB" },

  { spellId: 642, name: "Divine Shield", wowClass: "PALADIN", kind: "IMMUNITY" },
  { spellId: 498, name: "Divine Protection", wowClass: "PALADIN", specs: ["Holy"], kind: "MITIGATION" },
  { spellId: 403876, name: "Divine Protection", wowClass: "PALADIN", specs: ["Retribution"], kind: "MITIGATION" },
  { spellId: 31850, name: "Ardent Defender", wowClass: "PALADIN", specs: ["Protection"], kind: "MITIGATION" },
  { spellId: 86659, name: "Guardian of Ancient Kings", wowClass: "PALADIN", specs: ["Protection"], kind: "MITIGATION" },
  { spellId: 212641, name: "Guardian of Ancient Kings", wowClass: "PALADIN", specs: ["Protection"], kind: "MITIGATION" },

  { spellId: 19236, name: "Desperate Prayer", wowClass: "PRIEST", kind: "SELF_HEAL_MAJOR" },
  { spellId: 47585, name: "Dispersion", wowClass: "PRIEST", specs: ["Shadow"], kind: "MITIGATION" },

  { spellId: 31224, name: "Cloak of Shadows", wowClass: "ROGUE", kind: "IMMUNITY" },
  { spellId: 5277, name: "Evasion", wowClass: "ROGUE", kind: "MITIGATION" },
  { spellId: 1966, name: "Feint", wowClass: "ROGUE", kind: "MITIGATION" },
  { spellId: 185311, name: "Crimson Vial", wowClass: "ROGUE", kind: "SELF_HEAL_MAJOR" },

  { spellId: 108271, name: "Astral Shift", wowClass: "SHAMAN", kind: "MITIGATION" },

  { spellId: 104773, name: "Unending Resolve", wowClass: "WARLOCK", kind: "MITIGATION" },
  { spellId: 108416, name: "Dark Pact", wowClass: "WARLOCK", kind: "ABSORB" },

  { spellId: 118038, name: "Die by the Sword", wowClass: "WARRIOR", specs: ["Arms"], kind: "MITIGATION" },
  { spellId: 871, name: "Shield Wall", wowClass: "WARRIOR", specs: ["Protection"], kind: "MITIGATION" },
  { spellId: 23920, name: "Spell Reflection", wowClass: "WARRIOR", kind: "MITIGATION" },
];

const BY_SPELL_ID = new Map(PERSONAL_DEFENSIVE_CATALOG.map((entry) => [entry.spellId, entry]));

export function findPersonalDefensive(spellId: number): PersonalDefensiveEntry | null {
  return BY_SPELL_ID.get(spellId) ?? null;
}

/** Spell ids added to the existing Casts filter (same request, no extra WCL call). */
export function personalDefensiveSpellIds(): number[] {
  return PERSONAL_DEFENSIVE_CATALOG.map((entry) => entry.spellId);
}
