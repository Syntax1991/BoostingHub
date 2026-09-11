import { describe, expect, it } from "vitest";
import { attackTypeForSpecialization, isRoleValidForClass, rolesForClass } from "@/lib/wow-specializations";

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
