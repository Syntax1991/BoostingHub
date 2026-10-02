import { describe, expect, it } from "vitest";
import { countRolesByBucket } from "@/lib/roster-role-buckets";
import {
  additionalPlayableSpecLabels,
  formatCharacterRosterMetadata,
  type CharacterRosterMetadataInput,
} from "@/lib/character-roster-metadata";
import {
  resolveEffectivePersistedSelectedRole,
  resolveSignupAssignableRoles,
  rosterRoleSectionsForSignup,
} from "@/lib/signup-assignable-roles";

const restoShaman: CharacterRosterMetadataInput = {
  itemLevel: 325,
  specialization: "Restoration",
  primaryRole: "HEALER",
  wowClass: "SHAMAN",
};

describe("character roster metadata (offspec display)", () => {
  it("1. primary-only Character renders Restoration and no Offspec label", () => {
    expect(formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: [] })).toBe(
      "325 ilvl · Restoration",
    );
    expect(formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: [] })).not.toMatch(/Offspec/i);
  });

  it("2. one additional spec renders Offspec: Elemental", () => {
    expect(formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: ["Elemental"] })).toBe(
      "325 ilvl · Restoration · Offspec: Elemental",
    );
  });

  it("3. multiple additional specs render Offspecs: Elemental, Enhancement", () => {
    expect(
      formatCharacterRosterMetadata({
        ...restoShaman,
        playableSpecs: ["Elemental", "Enhancement"],
      }),
    ).toBe("325 ilvl · Restoration · Offspecs: Elemental, Enhancement");
  });

  it("4. Druid all-spec capability shows Balance, Feral, and Guardian in catalog order", () => {
    const text = formatCharacterRosterMetadata({
      itemLevel: 313,
      specialization: "Restoration",
      primaryRole: "HEALER",
      wowClass: "DRUID",
      playableSpecs: ["Guardian", "Balance", "Feral"],
    });
    expect(text).toBe("313 ilvl · Restoration · Offspecs: Balance, Feral, Guardian");
  });

  it("5. primary duplicate sanitation drops Restoration from the offspec list", () => {
    expect(
      additionalPlayableSpecLabels({
        ...restoShaman,
        playableSpecs: ["Restoration", "Elemental"],
      }),
    ).toEqual(["Elemental"]);
    expect(
      formatCharacterRosterMetadata({
        ...restoShaman,
        playableSpecs: ["Restoration", "Elemental"],
      }),
    ).toBe("325 ilvl · Restoration · Offspec: Elemental");
  });

  it("Holy Paladin example", () => {
    expect(
      formatCharacterRosterMetadata({
        itemLevel: 315,
        specialization: "Holy",
        primaryRole: "HEALER",
        wowClass: "PALADIN",
        playableSpecs: ["Retribution"],
      }),
    ).toBe("315 ilvl · Holy · Offspec: Retribution");
  });

  it("catalog order wins over alphabetical input (Evoker)", () => {
    expect(
      formatCharacterRosterMetadata({
        itemLevel: 320,
        specialization: "Devastation",
        primaryRole: "RANGED_DPS",
        wowClass: "EVOKER",
        playableSpecs: ["Augmentation", "Preservation"],
      }),
    ).toBe("320 ilvl · Devastation · Offspecs: Preservation, Augmentation");
  });

  it("6. displaying Enhancement does not add MELEE_DPS to modern offered roles", () => {
    const signup = {
      offeredRoles: ["HEALER", "RANGED_DPS"] as const,
      characterClass: "SHAMAN" as const,
      primarySpecialization: "Restoration",
      playableSpecs: ["Elemental", "Enhancement"],
    };
    const text = formatCharacterRosterMetadata({
      ...restoShaman,
      itemLevel: 327,
      playableSpecs: signup.playableSpecs,
    });
    expect(text).toBe("327 ilvl · Restoration · Offspecs: Elemental, Enhancement");
    expect(resolveSignupAssignableRoles(signup)).toEqual(["HEALER", "RANGED_DPS"]);
    expect(resolveSignupAssignableRoles(signup)).not.toContain("MELEE_DPS");
  });

  it("7. rendering Enhancement does not change an existing RANGED_DPS selection", () => {
    const signup = {
      offeredRoles: ["HEALER", "RANGED_DPS"] as const,
      characterClass: "SHAMAN" as const,
      primarySpecialization: "Restoration",
      playableSpecs: ["Elemental", "Enhancement"],
    };
    expect(
      resolveEffectivePersistedSelectedRole({ storedSelectedRole: "RANGED_DPS", signup }),
    ).toBe("RANGED_DPS");
    expect(formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: signup.playableSpecs })).toContain(
      "Enhancement",
    );
  });

  it("8. historic DPS resolution, bucket, and composition stay independent of the label", () => {
    const signup = {
      offeredRoles: ["HEALER", "DPS"] as const,
      characterClass: "SHAMAN" as const,
      primarySpecialization: "Restoration",
      playableSpecs: ["Elemental"],
    };
    const before = resolveEffectivePersistedSelectedRole({ storedSelectedRole: "DPS", signup });
    const sections = rosterRoleSectionsForSignup(signup);
    const text = formatCharacterRosterMetadata({
      ...restoShaman,
      playableSpecs: ["Elemental"],
    });
    const after = resolveEffectivePersistedSelectedRole({ storedSelectedRole: "DPS", signup });
    expect(before).toBe("RANGED_DPS");
    expect(after).toBe("RANGED_DPS");
    expect(sections.assignableRoles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(sections.sections).toEqual(["HEALER", "RANGED_DPS"]);
    expect(text).toBe("325 ilvl · Restoration · Offspec: Elemental");
    expect(countRolesByBucket([before])).toEqual({
      tanks: 0,
      healers: 0,
      meleeDps: 0,
      rangedDps: 1,
      legacyDps: 0,
      dps: 1,
    });
  });

  it("9. the same character metadata is used for every projected section", () => {
    const signup = {
      offeredRoles: ["HEALER", "RANGED_DPS"] as const,
      characterClass: "SHAMAN" as const,
      primarySpecialization: "Restoration",
      playableSpecs: ["Elemental", "Enhancement"],
    };
    const metadata = formatCharacterRosterMetadata({
      ...restoShaman,
      playableSpecs: signup.playableSpecs,
    });
    const { sections } = rosterRoleSectionsForSignup(signup);
    expect(sections).toEqual(["HEALER", "RANGED_DPS"]);
    expect(sections.map(() => metadata)).toEqual([metadata, metadata]);
    expect(metadata).toBe("325 ilvl · Restoration · Offspecs: Elemental, Enhancement");
  });
});
