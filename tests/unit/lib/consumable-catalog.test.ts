import { describe, expect, it } from "vitest";
import { CONSUMABLE_CATALOG, consumableSpellIds, findConsumableBySpellId } from "@/lib/consumable-catalog";

/** Warcraft Logs abilityGameIDs (= use spells) of the Midnight combat potions. */
const LIGHTS_POTENTIAL = 1236616;
const POTION_OF_ZEALOTRY = 1238443;

describe("consumable catalog — combat potions", () => {
  it("Light's Potential (normal and cauldron 'Fleeting' variant share one spell) is a combat potion", () => {
    expect(findConsumableBySpellId(LIGHTS_POTENTIAL)).toMatchObject({ category: "DAMAGE_POTION", name: "Light's Potential" });
    expect(findConsumableBySpellId(POTION_OF_ZEALOTRY)).toMatchObject({ category: "DAMAGE_POTION", name: "Potion of Zealotry" });
  });

  it("the Warcraft Logs cast filter requests them (casts are fetched by catalog spell id)", () => {
    const castIds = consumableSpellIds("CAST");
    expect(castIds).toEqual(expect.arrayContaining([LIGHTS_POTENTIAL, POTION_OF_ZEALOTRY, 1236994, 1236998]));
  });

  it("holds spell ids only — never potion item ids or cauldron placement spells", () => {
    const ids = CONSUMABLE_CATALOG.map((entry) => entry.spellId);
    // Light's Potential / Fleeting items, Recklessness / Fleeting items, Zealotry / Fleeting items.
    for (const itemId of [241308, 241309, 245897, 245898, 241288, 241289, 245902, 245903, 241296, 241297, 245900, 245901]) {
      expect(ids).not.toContain(itemId);
    }
    // "Prepare Midnight Potion Cauldron".
    expect(ids).not.toContain(1240267);
    expect(ids).not.toContain(1240225);
  });

  it("has no duplicate spell ids", () => {
    const ids = CONSUMABLE_CATALOG.map((entry) => entry.spellId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
