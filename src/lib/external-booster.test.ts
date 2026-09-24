import { describe, expect, it } from "vitest";
import {
  EXTERNAL_BOOSTER_NAME_MAX_LENGTH,
  externalBoosterInputError,
  mapExternalBoosters,
  normalizeExternalBoosterInput,
  normalizeExternalBoosterName,
} from "@/lib/external-booster";
import { defaultDpsAttackTypeForClass } from "@/lib/wow-specializations";

describe("external booster input", () => {
  it("normalizes a pasted @name and extra whitespace", () => {
    expect(normalizeExternalBoosterName("  @dawn  ")).toBe("dawn");
    expect(normalizeExternalBoosterName("@@Syn   Tax")).toBe("Syn Tax");
  });

  it("accepts Discord-style names and Character names", () => {
    for (const name of ["dawn", "@dawn", "syntax_1991", "Dr.Heal", "Sÿntax", "big-pump 2"]) {
      expect(externalBoosterInputError({ name, wowClass: "MAGE", role: "DPS" })).toBeNull();
    }
  });

  it("rejects empty, too long, markdown/mention syntax and mass-mention names", () => {
    const invalid = [
      "",
      "   ",
      "@",
      "x".repeat(EXTERNAL_BOOSTER_NAME_MAX_LENGTH + 1),
      "<@123>",
      "**bold**",
      "a`b",
      "a|b",
      "#channel",
      "everyone",
      "@here",
    ];
    for (const name of invalid) {
      expect(externalBoosterInputError({ name, wowClass: "MAGE", role: "DPS" }), name).not.toBeNull();
    }
  });

  it("a lootbuddy needs a class but no role; a booster still needs a valid role", () => {
    expect(externalBoosterInputError({ name: "loot", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: null })).toBeNull();
    expect(externalBoosterInputError({ name: "dawn", wowClass: "MAGE", participationType: "BOOSTER", role: null })).toMatch(
      /needs a role/,
    );
    expect(normalizeExternalBoosterInput({ name: " @loot ", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: "DPS" })).toEqual({
      name: "loot",
      wowClass: "ROGUE",
      participationType: "LOOTBUDDY",
      role: null,
    });
    expect(normalizeExternalBoosterInput({ name: "dawn", wowClass: "MAGE", role: "DPS" }).participationType).toBe("BOOSTER");
  });

  it("rejects a role the class cannot play", () => {
    expect(externalBoosterInputError({ name: "dawn", wowClass: "MAGE", role: "TANK" })).toMatch(/cannot play/);
    expect(externalBoosterInputError({ name: "dawn", wowClass: "PALADIN", role: "TANK" })).toBeNull();
  });

  it("maps persisted rows in the order they were added", () => {
    expect(
      mapExternalBoosters([
        { id: "b", name: "second", wowClass: "PRIEST", role: "HEALER", createdAt: "2026-09-24T18:00:00.001Z" },
        { id: "a", name: "first", wowClass: "MAGE", role: "DPS", createdAt: "2026-09-24T18:00:00.000Z" },
      ]),
    ).toEqual([
      { id: "a", name: "first", wowClass: "MAGE", participationType: "BOOSTER", role: "DPS" },
      { id: "b", name: "second", wowClass: "PRIEST", participationType: "BOOSTER", role: "HEALER" },
    ]);
    expect(
      mapExternalBoosters([
        { id: "c", name: "loot", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: null, createdAt: "x" },
      ]),
    ).toEqual([{ id: "c", name: "loot", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: null }]);
    expect(mapExternalBoosters(undefined)).toEqual([]);
  });

  it("guesses melee/ranged from the class for DPS without a spec", () => {
    expect(defaultDpsAttackTypeForClass("MAGE")).toBe("RANGED");
    expect(defaultDpsAttackTypeForClass("HUNTER")).toBe("RANGED");
    expect(defaultDpsAttackTypeForClass("ROGUE")).toBe("MELEE");
    expect(defaultDpsAttackTypeForClass("SHAMAN")).toBe("MELEE");
  });
});
