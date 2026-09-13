import { describe, expect, it } from "vitest";
import { renderRunStartMessageText } from "@/discord-bot/embeds/run-start-embed";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

function sampleData(overrides: Partial<RunStartEmbedData> = {}): RunStartEmbedData {
  return {
    runId: "run-1",
    runTitle: "Thu 19:00 HC Unsaved 8/8 Lead",
    raidName: "Venomous Abyss",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: "2026-09-18T17:00:00.000Z",
    groups: {
      tanks: [
        {
          signupId: "t1",
          userId: "u1",
          userName: "Dusk",
          discordUserId: "111",
          characterName: "Duskmaven",
          characterRealm: "Draenor",
          classLabel: "Death Knight",
          saveLabel: "Unsaved",
          participationType: "BOOSTER",
          role: "TANK",
        },
      ],
      healers: [],
      dps: [
        {
          signupId: "d1",
          userId: "u2",
          userName: "Kael",
          discordUserId: null,
          characterName: "Kaelstorm",
          characterRealm: "Draenor",
          classLabel: "Shaman",
          saveLabel: "Saved",
          participationType: "BOOSTER",
          role: "DPS",
        },
      ],
      lootbuddies: [
        {
          signupId: "l1",
          userId: "u3",
          userName: "Mira",
          discordUserId: "222",
          characterName: "Mage",
          characterRealm: "",
          classLabel: "Mage",
          saveLabel: "Unknown",
          participationType: "LOOTBUDDY",
          role: null,
        },
        {
          signupId: "l2",
          userId: "u4",
          userName: "NoDiscord",
          discordUserId: null,
          characterName: "Priest",
          characterRealm: "",
          classLabel: null,
          saveLabel: "Unknown",
          participationType: "LOOTBUDDY",
          role: null,
        },
      ],
    },
    goldCollectors: [
      { name: "Duskgc", realm: "Draenor" },
      { name: "Duskalli", realm: "Draenor" },
    ],
    totalSelected: 4,
    ...overrides,
  };
}

describe("buildRunStartEmbed / renderRunStartMessageText", () => {
  it("groups tanks/healers/dps/lootbuddies with counts, mentions, class, save, and collector commands", () => {
    const text = renderRunStartMessageText(sampleData());
    expect(text).toContain("**TANKS (1)**");
    expect(text).toContain("**HEALERS (0)**");
    expect(text).toContain("**DPS (1)**");
    expect(text).toContain("**LOOTBUDDIES (2)**");
    expect(text).toContain("<@111> - Duskmaven - Death Knight - Unsaved");
    expect(text).toContain("@Kael - Kaelstorm - Shaman - Saved");
    expect(text).toContain("<@222> - Mage");
    expect(text).toContain("@NoDiscord");
    expect(text).toContain("/w Duskgc-Draenor inv");
    expect(text).toContain("/w Duskalli-Draenor inv");
    expect(text).toContain("Venomous Abyss");
    expect(text).toContain("Heroic");
    expect(text).toContain("Unsaved");
  });

  it("does not invent Discord mentions when discordUserId is missing", () => {
    const text = renderRunStartMessageText(sampleData());
    expect(text).not.toMatch(/@Kael.*<@/);
    expect(text).toContain("@Kael -");
  });
});
