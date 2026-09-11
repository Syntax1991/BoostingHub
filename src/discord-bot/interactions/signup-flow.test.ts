import { describe, expect, it } from "vitest";
import { buildCharacterSelectOptions, buildRoleSelectOptions, groupRolesByCharacter } from "@/discord-bot/interactions/signup-flow";

const hybridPaladin = { characterId: "c-pala", characterName: "Holyfist", realm: "Tarren Mill" };
const singleRoleHunter = { characterId: "c-hunt", characterName: "Quickshot", realm: "Tarren Mill", role: "DPS" };

describe("buildCharacterSelectOptions", () => {
  it("collapses a hybrid Character's multiple (Character, role) rows into a single option", () => {
    const eligible = [
      { ...hybridPaladin, role: "TANK" },
      { ...hybridPaladin, role: "HEALER" },
      { ...hybridPaladin, role: "DPS" },
    ];
    const options = buildCharacterSelectOptions(eligible, "BOOSTER", {
      participationType: null,
      characterIds: [],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());

    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("c-pala");
    expect(options[0]?.label).toBe("Holyfist-Tarren Mill");
  });

  it("preselects a Character with an active offer of the same participation type", () => {
    const options = buildCharacterSelectOptions([singleRoleHunter], "BOOSTER", {
      participationType: "BOOSTER",
      characterIds: ["c-hunt"],
      roleByCharacterId: { "c-hunt": "DPS" },
    }).map((option) => option.toJSON());
    expect(options[0]?.default).toBe(true);
  });

  it("does not preselect anything when the active offer is a different participation type", () => {
    const options = buildCharacterSelectOptions([singleRoleHunter], "BOOSTER", {
      participationType: "LOOTBUDDY",
      characterIds: ["c-hunt"],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());
    expect(options[0]?.default).toBeFalsy();
  });

  it("has no role dimension for LOOTBUDDY: one option per Character", () => {
    const options = buildCharacterSelectOptions(
      [
        { characterId: "c-1", characterName: "A", realm: "R" },
        { characterId: "c-2", characterName: "B", realm: "R" },
      ],
      "LOOTBUDDY",
      { participationType: null, characterIds: [], roleByCharacterId: {} },
    ).map((option) => option.toJSON());
    expect(options.map((option) => option.value)).toEqual(["c-1", "c-2"]);
  });
});

describe("groupRolesByCharacter", () => {
  it("folds flattened (Character, role) rows into one entry per Character listing all its eligible roles", () => {
    const eligible = [
      { ...hybridPaladin, role: "TANK" },
      { ...hybridPaladin, role: "HEALER" },
      { ...singleRoleHunter },
    ];
    const grouped = groupRolesByCharacter(eligible);
    expect(grouped.get("c-pala")).toEqual({ characterName: "Holyfist", realm: "Tarren Mill", roles: ["TANK", "HEALER"] });
    expect(grouped.get("c-hunt")).toEqual({ characterName: "Quickshot", realm: "Tarren Mill", roles: ["DPS"] });
  });
});

describe("buildRoleSelectOptions", () => {
  it("offers one option per role, preselecting the given default", () => {
    const options = buildRoleSelectOptions(["TANK", "HEALER", "DPS"], "HEALER").map((option) => option.toJSON());
    expect(options.map((option) => option.value)).toEqual(["TANK", "HEALER", "DPS"]);
    expect(options.find((option) => option.value === "HEALER")?.default).toBe(true);
    expect(options.find((option) => option.value === "TANK")?.default).toBeFalsy();
  });
});
