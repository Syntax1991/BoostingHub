import { describe, expect, it } from "vitest";
import {
  assertOfferedRolesAllowed,
  availableRoles,
  configuredSpecs,
  normalizePlayableSpecs,
  remainingSpecsForClass,
} from "@/lib/character-capabilities";
import { DomainError } from "@/lib/errors";

describe("character capabilities", () => {
  it("1. Restoration Shaman primary only → HEALER", () => {
    expect(
      availableRoles({ wowClass: "SHAMAN", specialization: "Restoration", playableSpecs: [] }),
    ).toEqual(["HEALER"]);
  });

  it("2. Restoration + Elemental → HEALER + RANGED_DPS", () => {
    expect(
      availableRoles({
        wowClass: "SHAMAN",
        specialization: "Restoration",
        playableSpecs: ["Elemental"],
      }),
    ).toEqual(["HEALER", "RANGED_DPS"]);
  });

  it("3. Restoration + Enhancement → HEALER + MELEE_DPS", () => {
    expect(
      availableRoles({
        wowClass: "SHAMAN",
        specialization: "Restoration",
        playableSpecs: ["Enhancement"],
      }),
    ).toEqual(["HEALER", "MELEE_DPS"]);
  });

  it("4. Restoration + Elemental + Enhancement → all three", () => {
    expect(
      availableRoles({
        wowClass: "SHAMAN",
        specialization: "Restoration",
        playableSpecs: ["Elemental", "Enhancement"],
      }),
    ).toEqual(["HEALER", "MELEE_DPS", "RANGED_DPS"]);
  });

  it("5. Restoration Druid + Balance + Feral + Guardian → all four concrete roles", () => {
    expect(
      availableRoles({
        wowClass: "DRUID",
        specialization: "Restoration",
        playableSpecs: ["Balance", "Feral", "Guardian"],
      }),
    ).toEqual(["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS"]);
  });

  it("6. Disc + Holy + Shadow preserves three specs and dedupes roles to HEALER + RANGED_DPS", () => {
    const specs = configuredSpecs({
      wowClass: "PRIEST",
      specialization: "Discipline",
      playableSpecs: ["Holy", "Shadow"],
    });
    expect(specs.map((s) => s.specialization).sort()).toEqual(["Discipline", "Holy", "Shadow"]);
    expect(
      availableRoles({
        wowClass: "PRIEST",
        specialization: "Discipline",
        playableSpecs: ["Holy", "Shadow"],
      }),
    ).toEqual(["HEALER", "RANGED_DPS"]);
  });

  it("7. invalid spec for class rejected", () => {
    expect(() =>
      normalizePlayableSpecs({
        wowClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Arcane"],
      }),
    ).toThrow(DomainError);
  });

  it("8. primary cannot also be an additional playable spec", () => {
    expect(() =>
      normalizePlayableSpecs({
        wowClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Restoration"],
      }),
    ).toThrow(/already the primary/);
  });

  it("9. duplicate additional spec rejected", () => {
    expect(() =>
      normalizePlayableSpecs({
        wowClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental", "Elemental"],
      }),
    ).toThrow(/Duplicate/);
  });

  it("10. Select all remaining specs returns every non-primary catalog spec", () => {
    expect(remainingSpecsForClass("DRUID", "Restoration").sort()).toEqual(
      ["Balance", "Feral", "Guardian"].sort(),
    );
  });

  it("11–14. signup offers must match configured capabilities", () => {
    const restoOnly = { wowClass: "SHAMAN" as const, specialization: "Restoration", playableSpecs: [] as string[] };
    expect(() => assertOfferedRolesAllowed(restoOnly, ["RANGED_DPS"], "Syn")).toThrow(/not configured/);
    expect(assertOfferedRolesAllowed({ ...restoOnly, playableSpecs: ["Elemental"] }, ["HEALER", "RANGED_DPS"], "Syn")).toEqual([
      "HEALER",
      "RANGED_DPS",
    ]);
    expect(() =>
      assertOfferedRolesAllowed({ ...restoOnly, playableSpecs: ["Elemental"] }, ["MELEE_DPS"], "Syn"),
    ).toThrow(/not configured/);
    expect(assertOfferedRolesAllowed({ ...restoOnly, playableSpecs: ["Enhancement"] }, ["MELEE_DPS"], "Syn")).toEqual([
      "MELEE_DPS",
    ]);
  });

  it("26–27. generic DPS is never accepted as an offered role", () => {
    expect(() =>
      assertOfferedRolesAllowed(
        { wowClass: "WARRIOR", specialization: "Arms", playableSpecs: [] },
        ["DPS"],
        "Syn",
      ),
    ).toThrow(/Generic DPS/);
  });

  it("32–33. primary-only character does not invent offspecs", () => {
    expect(
      configuredSpecs({ wowClass: "SHAMAN", specialization: "Restoration", playableSpecs: [] }),
    ).toEqual([{ specialization: "Restoration", role: "HEALER" }]);
  });
});
