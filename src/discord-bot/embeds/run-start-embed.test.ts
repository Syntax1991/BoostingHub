import { describe, expect, it } from "vitest";
import { buildRunStartEmbed, renderRunStartMessageText } from "@/discord-bot/embeds/run-start-embed";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

function sampleData(overrides: Partial<RunStartEmbedData> = {}): RunStartEmbedData {
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
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          saveLabel: "Unsaved",
          participationType: "BOOSTER",
          role: "TANK",
        },
        {
          signupId: "t2",
          userId: "u5",
          userName: "Ceravian",
          discordUserId: "112",
          characterName: "Ceravian",
          characterRealm: "Draenor",
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          saveLabel: "Saved",
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
          wowClass: "SHAMAN",
          classLabel: "Shaman",
          saveLabel: "Fully saved",
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
          wowClass: "MAGE",
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
          wowClass: null,
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
    totalSelected: 5,
    ...overrides,
  };
}

describe("buildRunStartEmbed / renderRunStartMessageText", () => {
  it("renders a compact Final Setup with selected/target role counts", () => {
    const embed = buildRunStartEmbed(sampleData());
    expect(embed.data.title).toBe("Final Setup");

    const text = renderRunStartMessageText(sampleData());
    expect(text.startsWith("Final Setup")).toBe(true);
    expect(text).toContain("🛡 **Tanks** 🛡 2/2");
    expect(text).toContain("✚ **Healers** ✚ 0/2");
    expect(text).toContain("⚔ **DPS** ⚔ 1/8");
    expect(text).toContain("📦 **Lootbuddies** 📦 2");
    expect(text).not.toMatch(/Melee DPS|Ranged DPS/i);
  });

  it("renders compact booster and lootbuddy rows without save status", () => {
    const text = renderRunStartMessageText(sampleData());
    expect(text).toContain("<@111> — Duskmaven-Draenor — Death Knight");
    expect(text).toContain("@Kael — Kaelstorm-Draenor — Shaman");
    expect(text).toContain("<@222> — Mage");
    expect(text).toContain("@NoDiscord");
    expect(text).not.toMatch(/ - Unsaved| - Saved| - Fully saved| — Unsaved| — Saved| — Fully saved/);
    expect(text).not.toContain("Thu 19:00 HC Unsaved 8/8 Lead");
    expect(text).not.toMatch(/^Venomous Abyss - /m);
  });

  it("keeps both gold collector commands and does not invent Discord mentions", () => {
    const text = renderRunStartMessageText(sampleData());
    expect(text).toContain("/w Duskgc-Draenor inv");
    expect(text).toContain("/w Duskalli-Draenor inv");
    expect(text).not.toMatch(/@Kael.*<@/);
    expect(text).toContain("@Kael —");
  });

  it("uses Run desired composition targets, not selected counts, for denominators", () => {
    const text = renderRunStartMessageText(
      sampleData({
        targets: { tanks: 2, healers: 4, dps: 14 },
        groups: {
          tanks: sampleData().groups.tanks.slice(0, 1),
          healers: [],
          dps: [],
          lootbuddies: sampleData().groups.lootbuddies,
        },
      }),
    );
    expect(text).toContain("🛡 **Tanks** 🛡 1/2");
    expect(text).toContain("✚ **Healers** ✚ 0/4");
    expect(text).toContain("⚔ **DPS** ⚔ 0/14");
  });
});
