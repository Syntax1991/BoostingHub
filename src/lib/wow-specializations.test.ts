import { describe, expect, it } from "vitest";
import { attackTypeForSpecialization } from "@/lib/wow-specializations";

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
