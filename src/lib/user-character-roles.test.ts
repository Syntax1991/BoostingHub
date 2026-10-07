import { describe, expect, it } from "vitest";
import { unionActiveCharacterRoles } from "@/lib/user-character-roles";

describe("unionActiveCharacterRoles", () => {
  it("returns distinct concrete roles in stable order", () => {
    const roles = unionActiveCharacterRoles([
      {
        isActive: true,
        wowClass: "PRIEST",
        specialization: "Holy",
        playableSpecs: ["Shadow"],
      },
      {
        isActive: true,
        wowClass: "WARRIOR",
        specialization: "Protection",
        playableSpecs: [],
      },
      {
        isActive: true,
        wowClass: "MAGE",
        specialization: "Fire",
        playableSpecs: [],
      },
    ]);
    expect(roles).toEqual(["TANK", "HEALER", "RANGED_DPS"]);
  });

  it("ignores inactive characters", () => {
    const roles = unionActiveCharacterRoles([
      {
        isActive: false,
        wowClass: "WARRIOR",
        specialization: "Protection",
        playableSpecs: [],
      },
      {
        isActive: true,
        wowClass: "PRIEST",
        specialization: "Holy",
        playableSpecs: [],
      },
    ]);
    expect(roles).toEqual(["HEALER"]);
  });

  it("deduplicates the same role across characters", () => {
    const roles = unionActiveCharacterRoles([
      {
        isActive: true,
        wowClass: "PRIEST",
        specialization: "Holy",
        playableSpecs: [],
      },
      {
        isActive: true,
        wowClass: "DRUID",
        specialization: "Restoration",
        playableSpecs: [],
      },
    ]);
    expect(roles).toEqual(["HEALER"]);
  });

  it("keeps both melee and ranged DPS concrete", () => {
    const roles = unionActiveCharacterRoles([
      {
        isActive: true,
        wowClass: "WARRIOR",
        specialization: "Arms",
        playableSpecs: [],
      },
      {
        isActive: true,
        wowClass: "MAGE",
        specialization: "Fire",
        playableSpecs: [],
      },
    ]);
    expect(roles).toEqual(["MELEE_DPS", "RANGED_DPS"]);
  });

  it("returns empty when there are no active characters", () => {
    expect(unionActiveCharacterRoles([])).toEqual([]);
  });
});
