import { describe, expect, it } from "vitest";
import { buildCharacterSelectOptions, describeOfferResult } from "@/discord-bot/interactions/signup-flow";

const mistweaver: { characterId: string; characterName: string; realm: string; roles: ("TANK" | "HEALER" | "DPS")[]; defaultRole: "HEALER" | null } = {
  characterId: "c-mist",
  characterName: "Synmist",
  realm: "Antonidas",
  roles: ["TANK", "HEALER", "DPS"],
  defaultRole: "HEALER",
};

describe("buildCharacterSelectOptions", () => {
  it("labels a fresh selection with its specialization-derived default role", () => {
    const options = buildCharacterSelectOptions([mistweaver], "BOOSTER", {
      participationType: null,
      characterIds: [],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());

    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("c-mist");
    expect(options[0]?.label).toBe("Synmist-Antonidas — Healer (default)");
  });

  it("labels an existing offer with its persisted role, not the specialization default, when they differ", () => {
    const options = buildCharacterSelectOptions([mistweaver], "BOOSTER", {
      participationType: "BOOSTER",
      characterIds: ["c-mist"],
      roleByCharacterId: { "c-mist": "TANK" },
    }).map((option) => option.toJSON());
    expect(options[0]?.label).toBe("Synmist-Antonidas — Tank");
  });

  it("preselects a Character with an active offer of the same participation type", () => {
    const options = buildCharacterSelectOptions([mistweaver], "BOOSTER", {
      participationType: "BOOSTER",
      characterIds: ["c-mist"],
      roleByCharacterId: { "c-mist": "HEALER" },
    }).map((option) => option.toJSON());
    expect(options[0]?.default).toBe(true);
  });

  it("shows no role suffix for a Character with neither an existing offer nor a specialization default", () => {
    const options = buildCharacterSelectOptions(
      [{ characterId: "c-1", characterName: "A", realm: "R", roles: ["DPS", "HEALER"] as ("TANK" | "HEALER" | "DPS")[], defaultRole: null }],
      "BOOSTER",
      { participationType: null, characterIds: [], roleByCharacterId: {} },
    ).map((option) => option.toJSON());
    expect(options[0]?.label).toBe("A-R");
  });

  it("has no role suffix for LOOTBUDDY, which carries no role dimension", () => {
    const options = buildCharacterSelectOptions(
      [{ characterId: "c-1", characterName: "A", realm: "R" }],
      "LOOTBUDDY",
      { participationType: null, characterIds: [], roleByCharacterId: {} },
    ).map((option) => option.toJSON());
    expect(options[0]?.label).toBe("A-R");
  });
});

describe("describeOfferResult", () => {
  it("reports the cleared offers when submitting an empty set", () => {
    expect(describeOfferResult({ created: 0, reactivated: 0, withdrawn: 2, kept: 0 }, 0)).toBe(
      "Your offers for this run were cleared.",
    );
  });

  it("reports the active offer count otherwise", () => {
    expect(describeOfferResult({ created: 1, reactivated: 0, withdrawn: 0, kept: 1 }, 2)).toBe(
      "Signed up with 2 characters offered.",
    );
  });
});
