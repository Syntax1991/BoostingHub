import { describe, expect, it } from "vitest";
import { FINAL_SETUP_LFG_LINE, renderFinalSetupText } from "@/lib/run-start-message";
import { renderRunStartMessageText } from "@/discord-bot/messages/run-start-message";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

function sampleData(): RunStartEmbedData {
  return {
    runId: "run-1",
    runTitle: "Thu 19:00 HC Unsaved 8/8 Lead",
    raidName: "Venomous Abyss",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: "2026-09-18T17:00:00.000Z",
    targets: { tanks: 2, healers: 2, dps: 8 },
    groups: {
      tanks: [
        {
          signupId: "t1",
          userId: "u1",
          userName: "Dusk",
          discordUserId: "111",
          characterName: "Duskmaven",
          characterRealm: "Draenor",
          wowClass: "SHAMAN",
          classLabel: "Shaman",
          saveLabel: "Unsaved",
          participationType: "BOOSTER",
          selectedRole: "TANK",
        },
      ],
      healers: [],
      dps: [],
      lootbuddies: [
        {
          signupId: "l1",
          userId: "u3",
          userName: "Mira",
          discordUserId: "222",
          characterName: "Mage",
          characterRealm: "",
          wowClass: "MAGE",
          classLabel: "Mage",
          saveLabel: "Unknown",
          participationType: "LOOTBUDDY",
          selectedRole: null,
        },
      ],
    },
    totalSelected: 2,
  };
}

describe("renderRunStartMessageText", () => {
  it("returns plain Final Setup content with optional class emoji indicators", () => {
    const text = renderRunStartMessageText(sampleData(), {
      classIndicators: { SHAMAN: "<:shaman:999>" },
    });
    expect(text).toBe(
      renderFinalSetupText(
        {
          raidName: "Venomous Abyss",
          difficulty: "HEROIC",
          lootType: "UNSAVED",
          targets: { tanks: 2, healers: 2, dps: 8 },
          groups: {
            tanks: [
              {
                discordUserId: "111",
                userName: "Dusk",
                characterName: "Duskmaven",
                characterRealm: "Draenor",
                wowClass: "SHAMAN",
                classLabel: "Shaman",
                participationType: "BOOSTER",
                selectedRole: "TANK",
              },
            ],
            healers: [],
            dps: [],
            lootbuddies: [
              {
                discordUserId: "222",
                userName: "Mira",
                characterName: "Mage",
                characterRealm: "",
                wowClass: "MAGE",
                classLabel: "Mage",
                participationType: "LOOTBUDDY",
                selectedRole: null,
              },
            ],
          },
        },
        { classIndicators: { SHAMAN: "<:shaman:999>" } },
      ),
    );
    expect(text).toContain("<@111> <:shaman:999>");
    expect(text).toContain("<@222>");
    expect(text).toContain(FINAL_SETUP_LFG_LINE);
    expect(text).not.toContain("Duskmaven");
  });
});
