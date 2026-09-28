import { describe, expect, it } from "vitest";
import {
  WOW_SPECIALIZATIONS,
  attackTypeForSpecialization,
  isRoleValidForClass,
  knownSpecializationIds,
  rolesForClass,
  specializationById,
} from "@/lib/wow-specializations";

describe("attackTypeForSpecialization", () => {
  it("distinguishes the same spec name across classes (Frost Mage ranged vs Frost DK melee)", () => {
    expect(attackTypeForSpecialization("MAGE", "Frost")).toBe("RANGED");
    expect(attackTypeForSpecialization("DEATH_KNIGHT", "Frost")).toBe("MELEE");
  });

  it("classifies Survival Hunter as melee and the other Hunter specs as ranged", () => {
    expect(attackTypeForSpecialization("HUNTER", "Survival")).toBe("MELEE");
    expect(attackTypeForSpecialization("HUNTER", "Beast Mastery")).toBe("RANGED");
    expect(attackTypeForSpecialization("HUNTER", "Marksmanship")).toBe("RANGED");
  });

  it("classifies Demon Hunter Havoc as melee and Devourer as ranged", () => {
    expect(attackTypeForSpecialization("DEMON_HUNTER", "Havoc")).toBe("MELEE");
    expect(attackTypeForSpecialization("DEMON_HUNTER", "Devourer")).toBe("RANGED");
    expect(attackTypeForSpecialization("DEMON_HUNTER", "Vengeance")).toBeNull();
  });

  it("returns null for a TANK or HEALER specialization", () => {
    expect(attackTypeForSpecialization("PALADIN", "Protection")).toBeNull();
    expect(attackTypeForSpecialization("PALADIN", "Holy")).toBeNull();
  });

  it("returns null for a missing or unrecognized specialization", () => {
    expect(attackTypeForSpecialization("WARRIOR", null)).toBeNull();
    expect(attackTypeForSpecialization("WARRIOR", "Not A Real Spec")).toBeNull();
  });

  it("is case-insensitive, matching findSpecialization's own lookup", () => {
    expect(attackTypeForSpecialization("ROGUE", "assassination")).toBe("MELEE");
  });
});

describe("isRoleValidForClass", () => {
  it("Monk can Tank, Heal, or DPS", () => {
    expect(isRoleValidForClass("MONK", "TANK")).toBe(true);
    expect(isRoleValidForClass("MONK", "HEALER")).toBe(true);
    expect(isRoleValidForClass("MONK", "DPS")).toBe(true);
  });

  it("Paladin can Tank, Heal, or DPS", () => {
    expect(isRoleValidForClass("PALADIN", "TANK")).toBe(true);
    expect(isRoleValidForClass("PALADIN", "HEALER")).toBe(true);
    expect(isRoleValidForClass("PALADIN", "DPS")).toBe(true);
  });

  it("Shaman can Heal or DPS, never Tank", () => {
    expect(isRoleValidForClass("SHAMAN", "HEALER")).toBe(true);
    expect(isRoleValidForClass("SHAMAN", "DPS")).toBe(true);
    expect(isRoleValidForClass("SHAMAN", "TANK")).toBe(false);
  });

  it("Priest can Heal or DPS, never Tank", () => {
    expect(isRoleValidForClass("PRIEST", "HEALER")).toBe(true);
    expect(isRoleValidForClass("PRIEST", "DPS")).toBe(true);
    expect(isRoleValidForClass("PRIEST", "TANK")).toBe(false);
  });

  it("Mage can only DPS", () => {
    expect(isRoleValidForClass("MAGE", "DPS")).toBe(true);
    expect(isRoleValidForClass("MAGE", "HEALER")).toBe(false);
    expect(isRoleValidForClass("MAGE", "TANK")).toBe(false);
  });
});

describe("rolesForClass", () => {
  it("never depends on which specialization is currently imported — the same class always allows the same roles", () => {
    expect(new Set(rolesForClass("MONK"))).toEqual(new Set(["TANK", "HEALER", "DPS"]));
    expect(new Set(rolesForClass("PALADIN"))).toEqual(new Set(["TANK", "HEALER", "DPS"]));
    expect(new Set(rolesForClass("SHAMAN"))).toEqual(new Set(["HEALER", "DPS"]));
    expect(new Set(rolesForClass("PRIEST"))).toEqual(new Set(["HEALER", "DPS"]));
    expect(rolesForClass("MAGE")).toEqual(["DPS"]);
  });
});

describe("specializationById (Warcraft Logs CombatantInfo specID)", () => {
  it("covers every catalogued specialization exactly once, each with the catalog's role", () => {
    const resolved = knownSpecializationIds().map((id) => specializationById(id));
    expect(resolved.every(Boolean)).toBe(true);
    const keys = resolved.map((spec) => `${spec!.wowClass}:${spec!.name}`);
    const catalog = Object.entries(WOW_SPECIALIZATIONS).flatMap(([wowClass, specs]) => specs.map((spec) => `${wowClass}:${spec.name}`));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(catalog));
  });

  it("maps known ids (checked against the game's ChrSpecialization table)", () => {
    expect(specializationById(256)).toEqual({ wowClass: "PRIEST", name: "Discipline", role: "HEALER" });
    expect(specializationById(258)).toEqual({ wowClass: "PRIEST", name: "Shadow", role: "DPS" });
    expect(specializationById(73)).toEqual({ wowClass: "WARRIOR", name: "Protection", role: "TANK" });
    expect(specializationById(1468)).toEqual({ wowClass: "EVOKER", name: "Preservation", role: "HEALER" });
    expect(specializationById(1480)).toEqual({ wowClass: "DEMON_HUNTER", name: "Devourer", role: "DPS" });
  });

  it("an unknown id resolves to nothing (no guess)", () => {
    expect(specializationById(0)).toBeNull();
    expect(specializationById(99_999)).toBeNull();
  });
});
