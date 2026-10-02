import { describe, expect, it } from "vitest";
import { assertOfferedRolesAllowed, availableRoles } from "@/lib/character-capabilities";
import { assertConcreteRosterRole } from "@/lib/character-roles";
import { externalBoosterInputError } from "@/lib/external-booster";
import {
  resolveEffectivePersistedSelectedRole,
  resolveSignupAssignableRoles,
  rosterRoleSectionsForSignup,
} from "@/lib/signup-assignable-roles";
import type { CharacterRole, WowClass } from "@/models/enums";

function resolve(input: {
  offeredRoles: CharacterRole[];
  characterClass: WowClass;
  primarySpecialization: string | null;
  playableSpecs?: string[];
}) {
  return resolveSignupAssignableRoles(input);
}

describe("resolveSignupAssignableRoles — historic generic DPS", () => {
  it("1. historic Frost Mage DPS resolves to Ranged DPS", () => {
    expect(
      resolve({ offeredRoles: ["DPS"], characterClass: "MAGE", primarySpecialization: "Frost" }),
    ).toEqual(["RANGED_DPS"]);
  });

  it("2. historic Marksman Hunter DPS resolves to Ranged DPS", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "HUNTER",
        primarySpecialization: "Marksmanship",
      }),
    ).toEqual(["RANGED_DPS"]);
  });

  it("3. historic Shadow Priest DPS resolves to Ranged DPS", () => {
    expect(
      resolve({ offeredRoles: ["DPS"], characterClass: "PRIEST", primarySpecialization: "Shadow" }),
    ).toEqual(["RANGED_DPS"]);
  });

  it("4. historic Warlock DPS resolves to Ranged DPS", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "WARLOCK",
        primarySpecialization: "Demonology",
      }),
    ).toEqual(["RANGED_DPS"]);
  });

  it("5. historic Rogue DPS resolves to Melee DPS", () => {
    expect(
      resolve({ offeredRoles: ["DPS"], characterClass: "ROGUE", primarySpecialization: "Subtlety" }),
    ).toEqual(["MELEE_DPS"]);
  });

  it("6. historic Arms Warrior DPS resolves to Melee DPS", () => {
    expect(
      resolve({ offeredRoles: ["DPS"], characterClass: "WARRIOR", primarySpecialization: "Arms" }),
    ).toEqual(["MELEE_DPS"]);
  });

  it("7. historic Elemental Shaman DPS resolves to Ranged DPS", () => {
    expect(
      resolve({ offeredRoles: ["DPS"], characterClass: "SHAMAN", primarySpecialization: "Elemental" }),
    ).toEqual(["RANGED_DPS"]);
  });

  it("8. historic Enhancement Shaman DPS resolves to Melee DPS", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Enhancement",
      }),
    ).toEqual(["MELEE_DPS"]);
  });

  it("9. historic Resto Shaman with playable Elemental resolves to Healer + Ranged", () => {
    expect(
      resolve({
        offeredRoles: ["HEALER", "DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental"],
      }),
    ).toEqual(["HEALER", "RANGED_DPS"]);
  });

  it("10. historic Resto Shaman with Elemental and Enhancement resolves to all three", () => {
    expect(
      resolve({
        offeredRoles: ["HEALER", "DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental", "Enhancement"],
      }),
    ).toEqual(["HEALER", "MELEE_DPS", "RANGED_DPS"]);
  });

  it("11. historic Resto Shaman with no playable specs offers Healer, Melee, and Ranged", () => {
    expect(
      resolve({
        offeredRoles: ["HEALER", "DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: [],
      }),
    ).toEqual(["HEALER", "MELEE_DPS", "RANGED_DPS"]);
  });

  it("12. historic Resto Druid without playable specs offers both DPS subtypes", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "DRUID",
        primarySpecialization: "Restoration",
        playableSpecs: [],
      }),
    ).toEqual(["MELEE_DPS", "RANGED_DPS"]);
  });

  it("13. historic Holy Paladin DPS resolves to Melee DPS only", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "PALADIN",
        primarySpecialization: "Holy",
        playableSpecs: [],
      }),
    ).toEqual(["MELEE_DPS"]);
  });

  it("14. modern Resto Shaman without Enhancement does not gain Melee DPS", () => {
    expect(
      resolve({
        offeredRoles: ["HEALER", "RANGED_DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental"],
      }),
    ).toEqual(["HEALER", "RANGED_DPS"]);
    expect(
      availableRoles({
        wowClass: "SHAMAN",
        specialization: "Restoration",
        playableSpecs: ["Elemental"],
      }),
    ).toEqual(["HEALER", "RANGED_DPS"]);
  });

  it("15. class fallback is never used for a new signup capability", () => {
    const restoOnly = {
      wowClass: "SHAMAN" as const,
      specialization: "Restoration",
      playableSpecs: [] as string[],
    };
    expect(availableRoles(restoOnly)).toEqual(["HEALER"]);
    expect(() => assertOfferedRolesAllowed(restoOnly, ["MELEE_DPS"], "Synblast")).toThrow(/not configured/);
    expect(() => assertOfferedRolesAllowed(restoOnly, ["DPS"], "Synblast")).toThrow(/Generic DPS/);
    expect(
      resolve({
        offeredRoles: ["HEALER"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: [],
      }),
    ).toEqual(["HEALER"]);
  });

  it("16. generic DPS is never an assignable or writable roster role", () => {
    const roles = resolve({
      offeredRoles: ["DPS"],
      characterClass: "MAGE",
      primarySpecialization: "Frost",
    });
    expect(roles).not.toContain("DPS");
    expect(() => assertConcreteRosterRole("DPS")).toThrow(/Generic DPS/);
    expect(externalBoosterInputError({ name: "dawn", wowClass: "MAGE", role: "DPS" })).toMatch(/generic DPS/i);
  });

  it("primary DPS spec wins over other playable DPS specs", () => {
    expect(
      resolve({
        offeredRoles: ["DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Elemental",
        playableSpecs: ["Enhancement"],
      }),
    ).toEqual(["RANGED_DPS"]);
  });
});

describe("roster buckets for historic DPS", () => {
  it("21. a resolved Frost Mage is Ranged and a resolved Rogue is Melee", () => {
    expect(
      rosterRoleSectionsForSignup({
        offeredRoles: ["DPS"],
        characterClass: "MAGE",
        primarySpecialization: "Frost",
      }).sections,
    ).toEqual(["RANGED_DPS"]);
    expect(
      rosterRoleSectionsForSignup({
        offeredRoles: ["DPS"],
        characterClass: "ROGUE",
        primarySpecialization: "Subtlety",
      }).sections,
    ).toEqual(["MELEE_DPS"]);
  });

  it("22. only ambiguous historic DPS is Unassigned, and it is not duplicated", () => {
    expect(
      rosterRoleSectionsForSignup({
        offeredRoles: ["HEALER", "DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: [],
      }).sections,
    ).toEqual(["HEALER", "UNASSIGNED_DPS"]);
    expect(
      rosterRoleSectionsForSignup({
        offeredRoles: ["DPS"],
        characterClass: "DRUID",
        primarySpecialization: "Restoration",
      }).sections,
    ).toEqual(["UNASSIGNED_DPS"]);
    expect(
      rosterRoleSectionsForSignup({
        offeredRoles: ["HEALER", "RANGED_DPS"],
        characterClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental", "Enhancement"],
      }).sections,
    ).toEqual(["HEALER", "RANGED_DPS"]);
  });
});

describe("resolveEffectivePersistedSelectedRole", () => {
  const frost = {
    offeredRoles: ["DPS"] as CharacterRole[],
    characterClass: "MAGE" as WowClass,
    primarySpecialization: "Frost",
  };

  it("keeps a concrete stored role without re-deriving it", () => {
    expect(
      resolveEffectivePersistedSelectedRole({
        storedSelectedRole: "HEALER",
        signup: { ...frost, offeredRoles: ["HEALER", "DPS"] },
      }),
    ).toBe("HEALER");
  });

  it("normalizes a unique historic DPS assignment to that subtype", () => {
    expect(resolveEffectivePersistedSelectedRole({ storedSelectedRole: "DPS", signup: frost })).toBe("RANGED_DPS");
    expect(
      resolveEffectivePersistedSelectedRole({
        storedSelectedRole: "DPS",
        signup: {
          offeredRoles: ["DPS"],
          characterClass: "ROGUE",
          primarySpecialization: "Subtlety",
        },
      }),
    ).toBe("MELEE_DPS");
  });

  it("keeps Synblast's stored DPS intent as Ranged, not Healer", () => {
    expect(
      resolveEffectivePersistedSelectedRole({
        storedSelectedRole: "DPS",
        signup: {
          offeredRoles: ["HEALER", "DPS"],
          characterClass: "SHAMAN",
          primarySpecialization: "Restoration",
          playableSpecs: ["Elemental"],
        },
      }),
    ).toBe("RANGED_DPS");
  });

  it("leaves an ambiguous stored DPS assignment unresolved", () => {
    expect(
      resolveEffectivePersistedSelectedRole({
        storedSelectedRole: "DPS",
        signup: {
          offeredRoles: ["HEALER", "DPS"],
          characterClass: "SHAMAN",
          primarySpecialization: "Restoration",
          playableSpecs: [],
        },
      }),
    ).toBeNull();
  });
});
