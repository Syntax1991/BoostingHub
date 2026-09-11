import { describe, expect, it } from "vitest";
import { buildSelectOptions, parseSelectedOffers } from "@/discord-bot/interactions/signup-flow";

const hybridPaladin = { characterId: "c-pala", characterName: "Holyfist", realm: "Tarren Mill" };
const singleRoleHunter = { characterId: "c-hunt", characterName: "Quickshot", realm: "Tarren Mill", role: "DPS" };

describe("buildSelectOptions — BOOSTER", () => {
  it("offers one option per eligible role for a hybrid Character, never silently defaulting to one", () => {
    const eligible = [
      { ...hybridPaladin, role: "TANK" },
      { ...hybridPaladin, role: "HEALER" },
      { ...hybridPaladin, role: "DPS" },
    ];
    const options = buildSelectOptions(eligible, "BOOSTER", {
      participationType: null,
      characterIds: [],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());

    expect(options).toHaveLength(3);
    expect(options.map((option) => option.value)).toEqual(["c-pala:TANK", "c-pala:HEALER", "c-pala:DPS"]);
    expect(options.every((option) => option.label.includes("Holyfist-Tarren Mill"))).toBe(true);
  });

  it("preselects only the option matching the User's current offered role, not every role for that Character", () => {
    const eligible = [
      { ...hybridPaladin, role: "TANK" },
      { ...hybridPaladin, role: "HEALER" },
    ];
    const options = buildSelectOptions(eligible, "BOOSTER", {
      participationType: "BOOSTER",
      characterIds: ["c-pala"],
      roleByCharacterId: { "c-pala": "HEALER" },
    }).map((option) => option.toJSON());

    const tank = options.find((option) => option.value === "c-pala:TANK");
    const healer = options.find((option) => option.value === "c-pala:HEALER");
    expect(tank?.default).toBeFalsy();
    expect(healer?.default).toBe(true);
  });

  it("does not preselect anything when the active offer is a different participation type", () => {
    const options = buildSelectOptions([singleRoleHunter], "BOOSTER", {
      participationType: "LOOTBUDDY",
      characterIds: ["c-hunt"],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());
    expect(options[0]?.default).toBeFalsy();
  });
});

describe("buildSelectOptions — LOOTBUDDY", () => {
  it("has no role dimension: one option per Character", () => {
    const options = buildSelectOptions(
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

describe("parseSelectedOffers", () => {
  it("splits BOOSTER values back into characterId + role", () => {
    expect(parseSelectedOffers(["c-pala:TANK", "c-hunt:DPS"], "BOOSTER")).toEqual([
      { characterId: "c-pala", role: "TANK" },
      { characterId: "c-hunt", role: "DPS" },
    ]);
  });

  it("treats LOOTBUDDY values as plain characterIds with no role", () => {
    expect(parseSelectedOffers(["c-1", "c-2"], "LOOTBUDDY")).toEqual([{ characterId: "c-1" }, { characterId: "c-2" }]);
  });

  it("round-trips through buildSelectOptions for a hybrid Character", () => {
    const eligible = [
      { ...hybridPaladin, role: "TANK" },
      { ...hybridPaladin, role: "HEALER" },
    ];
    const options = buildSelectOptions(eligible, "BOOSTER", {
      participationType: null,
      characterIds: [],
      roleByCharacterId: {},
    }).map((option) => option.toJSON().value);
    const chosen = [options[1]]; // simulate the User picking the HEALER option
    expect(parseSelectedOffers(chosen, "BOOSTER")).toEqual([{ characterId: "c-pala", role: "HEALER" }]);
  });
});
