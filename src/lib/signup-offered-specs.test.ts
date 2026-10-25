import { describe, expect, it } from "vitest";
import { resolveDisplaySpecForSelectedRole, resolveOfferedSpecs } from "@/lib/signup-offered-specs";

describe("resolveOfferedSpecs", () => {
  it("returns primary + playable specs that match offered roles", () => {
    expect(
      resolveOfferedSpecs({
        wowClass: "SHAMAN",
        primarySpecialization: "Restoration",
        playableSpecs: ["Elemental"],
        offeredRoles: ["HEALER", "RANGED_DPS"],
      }),
    ).toEqual([
      { name: "Elemental", role: "RANGED_DPS" },
      { name: "Restoration", role: "HEALER" },
    ]);
  });

  it("keeps same-role multi-spec choices distinct (Holy / Discipline)", () => {
    expect(
      resolveOfferedSpecs({
        wowClass: "PRIEST",
        primarySpecialization: "Holy",
        playableSpecs: ["Discipline"],
        offeredRoles: ["HEALER"],
      }),
    ).toEqual([
      { name: "Discipline", role: "HEALER" },
      { name: "Holy", role: "HEALER" },
    ]);
  });

  it("fills an uncovered offered role from the class catalog", () => {
    // Mistweaver primary + offered MELEE → Windwalker (no playableSpecs row required).
    expect(
      resolveOfferedSpecs({
        wowClass: "MONK",
        primarySpecialization: "Mistweaver",
        playableSpecs: [],
        offeredRoles: ["HEALER", "MELEE_DPS"],
      }),
    ).toEqual([
      { name: "Mistweaver", role: "HEALER" },
      { name: "Windwalker", role: "MELEE_DPS" },
    ]);
  });

  it("does not invent a second same-role spec when one healer is already configured", () => {
    expect(
      resolveOfferedSpecs({
        wowClass: "PRIEST",
        primarySpecialization: "Holy",
        playableSpecs: [],
        offeredRoles: ["HEALER"],
      }),
    ).toEqual([{ name: "Holy", role: "HEALER" }]);
  });
});

describe("resolveDisplaySpecForSelectedRole", () => {
  it("prefers primary when multiple specs share the selected role", () => {
    expect(
      resolveDisplaySpecForSelectedRole(
        {
          wowClass: "PRIEST",
          primarySpecialization: "Holy",
          playableSpecs: ["Discipline"],
          offeredRoles: ["HEALER"],
        },
        "HEALER",
      ),
    ).toBe("Holy");
  });
});
