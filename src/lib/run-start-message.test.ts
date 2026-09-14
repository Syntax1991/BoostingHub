import { describe, expect, it } from "vitest";
import {
  formatFinalSetup,
  renderFinalSetupText,
  type FinalSetupInput,
} from "@/lib/run-start-message";
import { buildRunStartEmbed, renderRunStartMessageText } from "@/discord-bot/embeds/run-start-embed";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

function sampleInput(overrides: Partial<FinalSetupInput> = {}): FinalSetupInput {
  return {
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
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          participationType: "BOOSTER",
          selectedRole: "TANK",
        },
        {
          discordUserId: "112",
          userName: "Ceravian",
          characterName: "Ceravian",
          characterRealm: "Draenor",
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          participationType: "BOOSTER",
          selectedRole: "TANK",
        },
      ],
      healers: [],
      dps: [
        {
          discordUserId: null,
          userName: "Kael",
          characterName: "Kaelstorm",
          characterRealm: "Draenor",
          wowClass: "SHAMAN",
          classLabel: "Shaman",
          participationType: "BOOSTER",
          selectedRole: "DPS",
        },
      ],
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
        {
          discordUserId: null,
          userName: "NoDiscord",
          characterName: "Priest",
          characterRealm: "",
          wowClass: null,
          classLabel: null,
          participationType: "LOOTBUDDY",
          selectedRole: null,
        },
      ],
    },
    ...overrides,
  };
}

function sampleEmbedData(overrides: Partial<RunStartEmbedData> = {}): RunStartEmbedData {
  const input = sampleInput();
  return {
    runId: "run-1",
    runTitle: "Thu 19:00 HC Unsaved 8/8 Lead",
    raidName: input.raidName,
    difficulty: input.difficulty,
    lootType: input.lootType,
    scheduledStartAt: "2026-09-18T17:00:00.000Z",
    targets: input.targets,
    groups: {
      tanks: input.groups.tanks.map((m, i) => ({
        signupId: `t${i}`,
        userId: `u${i}`,
        ...m,
        saveLabel: "Unsaved",
      })),
      healers: [],
      dps: input.groups.dps.map((m, i) => ({
        signupId: `d${i}`,
        userId: `ud${i}`,
        ...m,
        saveLabel: "Fully saved",
      })),
      lootbuddies: input.groups.lootbuddies.map((m, i) => ({
        signupId: `l${i}`,
        userId: `ul${i}`,
        ...m,
        saveLabel: "Unknown",
      })),
    },
    totalSelected: 5,
    ...overrides,
  };
}

describe("formatFinalSetup", () => {
  it("renders Final Setup title and selected/target role counts", () => {
    const message = formatFinalSetup(sampleInput());
    expect(message.title).toBe("Final Setup");
    const text = renderFinalSetupText(sampleInput());
    expect(text).toContain("🛡 **Tanks** 🛡 2/2");
    expect(text).toContain("✚ **Healers** ✚ 0/2");
    expect(text).toContain("⚔ **DPS** ⚔ 1/8");
    expect(text).toContain("📦 **Lootbuddies** 📦 2");
    expect(text).not.toMatch(/Melee DPS|Ranged DPS/i);
  });

  it("renders compact participant lines without save status or collectors", () => {
    const text = renderFinalSetupText(sampleInput());
    expect(text).toContain("<@111> — Duskmaven-Draenor — Death Knight");
    expect(text).toContain("@Kael — Kaelstorm-Draenor — Shaman");
    expect(text).toContain("<@222> — Mage");
    expect(text).toContain("@NoDiscord");
    expect(text).not.toMatch(/Unsaved|Fully saved|Gold Collector|\/w |Duskgc|Duskalli/);
  });

  it("uses Run desired composition targets for denominators", () => {
    const text = renderFinalSetupText(
      sampleInput({
        targets: { tanks: 2, healers: 4, dps: 14 },
        groups: {
          tanks: sampleInput().groups.tanks.slice(0, 1),
          healers: [],
          dps: [],
          lootbuddies: sampleInput().groups.lootbuddies,
        },
      }),
    );
    expect(text).toContain("🛡 **Tanks** 🛡 1/2");
    expect(text).toContain("✚ **Healers** ✚ 0/4");
    expect(text).toContain("⚔ **DPS** ⚔ 0/14");
  });
});

describe("web / Discord Final Setup parity", () => {
  it("uses the same body from the shared formatter", () => {
    const input = sampleInput();
    const shared = formatFinalSetup(input);
    const embed = buildRunStartEmbed(sampleEmbedData());
    expect(embed.data.title).toBe(shared.title);
    expect(embed.data.description).toBe(shared.body);
    expect(embed.data.footer?.text).toBe(shared.footer);
    expect(renderRunStartMessageText(sampleEmbedData())).toBe(renderFinalSetupText(input));
  });
});
