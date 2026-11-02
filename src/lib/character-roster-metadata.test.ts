import { describe, expect, it } from "vitest";
import {
  additionalPlayableSpecLabels,
  formatCharacterPageSpecLine,
  formatCharacterRosterMetadata,
  type CharacterRosterMetadataInput,
} from "@/lib/character-roster-metadata";

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

  it("character page spec line uses the same offspec order and wording as roster cards", () => {
    const testdraco = {
      itemLevel: 321,
      specialization: "Preservation",
      primaryRole: "HEALER" as const,
      wowClass: "EVOKER" as const,
      playableSpecs: ["Augmentation", "Devastation"],
    };
    expect(formatCharacterPageSpecLine(testdraco)).toBe("Preservation · Offspecs: Devastation, Augmentation");
    expect(formatCharacterRosterMetadata(testdraco)).toBe(
      "321 ilvl · Preservation · Offspecs: Devastation, Augmentation",
    );

    const testvoid = {
      specialization: "Holy",
      wowClass: "PRIEST" as const,
      playableSpecs: ["Shadow", "Discipline"],
    };
    expect(formatCharacterPageSpecLine(testvoid)).toBe("Holy · Offspecs: Discipline, Shadow");
    expect(additionalPlayableSpecLabels(testvoid)).toEqual(["Discipline", "Shadow"]);

    expect(
      formatCharacterPageSpecLine({
        specialization: "Restoration",
        wowClass: "SHAMAN",
        playableSpecs: ["Restoration", "Elemental"],
      }),
    ).toBe("Restoration · Offspec: Elemental");
    expect(formatCharacterPageSpecLine({ specialization: "Marksmanship", wowClass: "HUNTER" })).toBe("Marksmanship");
    expect(formatCharacterPageSpecLine({ specialization: null })).toBe("No spec");
  });

});
