import { describe, expect, it } from "vitest";
import {
  additionalPlayableSpecLabels,
  formatCharacterRosterMetadata,
} from "@/lib/character-roster-metadata";

const restoShaman = {
  itemLevel: 325,
  specialization: "Restoration",
  primaryRole: "HEALER" as const,
};

describe("character roster metadata (offspec display)", () => {
  it("1. primary-only Character → no Offspec label", () => {
    expect(formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: [] })).toBe(
      "325 ilvl · Restoration",
    );
  });

  it("2. one additional playable spec → Offspec: X", () => {
    expect(
      formatCharacterRosterMetadata({ ...restoShaman, playableSpecs: ["Elemental"] }),
    ).toBe("325 ilvl · Restoration · Offspec: Elemental");
  });

  it("3. multiple additional playable specs → Offspecs: X, Y", () => {
    expect(
      formatCharacterRosterMetadata({
        ...restoShaman,
        playableSpecs: ["Elemental", "Enhancement"],
      }),
    ).toBe("325 ilvl · Restoration · Offspecs: Elemental, Enhancement");
  });

  it("4. primary spec never duplicated in offspec list", () => {
    expect(
      additionalPlayableSpecLabels({
        ...restoShaman,
        playableSpecs: ["Restoration", "Elemental"],
      }),
    ).toEqual(["Elemental"]);
    expect(
      formatCharacterRosterMetadata({
        ...restoShaman,
        playableSpecs: ["Restoration", "Elemental", "Enhancement"],
      }),
    ).toBe("325 ilvl · Restoration · Offspecs: Elemental, Enhancement");
  });

  it("Holy Paladin example", () => {
    expect(
      formatCharacterRosterMetadata({
        itemLevel: 315,
        specialization: "Holy",
        primaryRole: "HEALER",
        playableSpecs: ["Retribution"],
      }),
    ).toBe("315 ilvl · Holy · Offspec: Retribution");
  });

  it("Resto Druid example", () => {
    expect(
      formatCharacterRosterMetadata({
        itemLevel: 313,
        specialization: "Restoration",
        primaryRole: "HEALER",
        playableSpecs: ["Balance", "Feral", "Guardian"],
      }),
    ).toBe("313 ilvl · Restoration · Offspecs: Balance, Feral, Guardian");
  });
});
