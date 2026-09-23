import { describe, expect, it } from "vitest";
import {
  formatFinalSetup,
  formatFinalSetupLfgLine,
  renderFinalSetupText,
  type FinalSetupInput,
  type FinalSetupParticipant,
} from "@/lib/run-start-message";
import { renderRunStartMessageText } from "@/discord-bot/messages/run-start-message";
import type { RunStartEmbedData } from "@/services/discord-sync.service";
import type { WowClass } from "@/models/enums";

function participant(
  overrides: Partial<FinalSetupParticipant> & Pick<FinalSetupParticipant, "userName" | "participationType">,
): FinalSetupParticipant {
  return {
    discordUserId: null,
    characterName: overrides.userName,
    characterRealm: "",
    wowClass: null,
    classLabel: null,
    selectedRole: overrides.participationType === "LOOTBUDDY" ? null : "DPS",
    ...overrides,
  };
}

function sampleInput(overrides: Partial<FinalSetupInput> = {}): FinalSetupInput {
  return {
    raidName: "Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    raidLeadDisplayName: "Syntax",
    targets: { tanks: 2, healers: 2, dps: 8 },
    groups: {
      tanks: [
        participant({
          discordUserId: "111",
          userName: "Dusk",
          characterName: "Duskmaven",
          characterRealm: "Draenor",
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          participationType: "BOOSTER",
          selectedRole: "TANK",
        }),
        participant({
          discordUserId: "112",
          userName: "Ceravian",
          characterName: "Ceravian",
          characterRealm: "Draenor",
          wowClass: "DEATH_KNIGHT",
          classLabel: "Death Knight",
          participationType: "BOOSTER",
          selectedRole: "TANK",
        }),
      ],
      healers: [
        participant({
          discordUserId: "211",
          userName: "HealOne",
          wowClass: "SHAMAN",
          classLabel: "Shaman",
          participationType: "BOOSTER",
          selectedRole: "HEALER",
        }),
        participant({
          discordUserId: "212",
          userName: "HealTwo",
          wowClass: "EVOKER",
          classLabel: "Evoker",
          participationType: "BOOSTER",
          selectedRole: "HEALER",
        }),
      ],
      dps: [
        participant({
          discordUserId: null,
          userName: "Kael",
          characterName: "Kaelstorm",
          characterRealm: "Draenor",
          wowClass: "SHAMAN",
          classLabel: "Shaman",
          participationType: "BOOSTER",
          selectedRole: "DPS",
        }),
      ],
      lootbuddies: [
        participant({
          discordUserId: "222",
          userName: "Mira",
          characterName: "Mage",
          wowClass: "MAGE",
          classLabel: "Mage",
          participationType: "LOOTBUDDY",
        }),
        participant({
          discordUserId: null,
          userName: "NoDiscord",
          characterName: "Priest",
          participationType: "LOOTBUDDY",
        }),
        participant({ discordUserId: "223", userName: "L3", participationType: "LOOTBUDDY" }),
        participant({ discordUserId: "224", userName: "L4", participationType: "LOOTBUDDY" }),
        participant({ discordUserId: "225", userName: "L5", participationType: "LOOTBUDDY" }),
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
    productLabel: input.productLabel ?? input.raidName,
    contentSummary: input.contentSummary ?? "",
    difficulty: input.difficulty,
    lootType: input.lootType,
    scheduledStartAt: "2026-09-18T17:00:00.000Z",
    raidLeadDisplayName: input.raidLeadDisplayName,
    targets: input.targets,
    groups: {
      tanks: input.groups.tanks.map((m, i) => ({ signupId: `t${i}`, userId: `u${i}`, ...m, saveLabel: "Unsaved" })),
      healers: input.groups.healers.map((m, i) => ({ signupId: `h${i}`, userId: `uh${i}`, ...m, saveLabel: "Unsaved" })),
      dps: input.groups.dps.map((m, i) => ({ signupId: `d${i}`, userId: `ud${i}`, ...m, saveLabel: "Fully saved" })),
      lootbuddies: input.groups.lootbuddies.map((m, i) => ({
        signupId: `l${i}`,
        userId: `ul${i}`,
        ...m,
        saveLabel: "Unknown",
      })),
    },
    totalSelected: 10,
    ...overrides,
  };
}

describe("formatFinalSetupLfgLine — Run Raid Lead footer", () => {
  it("renders the exact footer for Syntax", () => {
    expect(formatFinalSetupLfgLine("Syntax")).toBe("**LFG HM Syntax write your discord name in the note!**");
  });

  it("renders the exact footer for Kiri", () => {
    expect(formatFinalSetupLfgLine("Kiri")).toBe("**LFG HM Kiri write your discord name in the note!**");
  });
});

describe("renderFinalSetupText — plain Discord Final Setup", () => {
  it("starts with bold Final Setup, role headers, and the Raid Lead LFG footer exactly once", () => {
    const text = renderFinalSetupText(sampleInput());
    expect(text.startsWith("**Final Setup**\n\n")).toBe(true);
    expect(text).toContain("🛡 **Tanks** 🛡 2/2");
    expect(text).toContain("✚ **Healers** ✚ 2/2");
    expect(text).toContain("⚔ **DPS** ⚔ 1/8");
    expect(text).toContain("📦 **Lootbuddies** 📦 5");
    expect(text.endsWith("\n\n**LFG HM Syntax write your discord name in the note!**")).toBe(true);
    expect(text.match(/LFG HM/g)).toHaveLength(1);
    const lootIdx = text.indexOf("📦 **Lootbuddies**");
    const lfgIdx = text.indexOf("**LFG HM Syntax");
    expect(lfgIdx).toBeGreaterThan(lootIdx);
  });

  it("uses the given Raid Lead, never a fixed name", () => {
    const text = renderFinalSetupText(sampleInput({ raidLeadDisplayName: "Kiri" }));
    expect(text.endsWith("**LFG HM Kiri write your discord name in the note!**")).toBe(true);
    expect(text).not.toContain("Krum");
    expect(text).not.toContain("LFG HM Syntax");
  });

  it("renders compact booster rows: mention + class indicator, no character/realm", () => {
    const text = renderFinalSetupText(sampleInput(), {
      classIndicators: { SHAMAN: "<:shaman:999>" },
    });
    expect(text).toContain("<@211> <:shaman:999>");
    expect(text).toContain("@Kael <:shaman:999>");
    expect(text).not.toContain("Duskmaven");
    expect(text).not.toContain("Draenor");
    expect(text).not.toContain("Kaelstorm");
    expect(text).not.toMatch(/Unsaved|Fully saved|Gold Collector/);
  });

  it("falls back to class label when custom emoji is missing (e.g. Priest)", () => {
    const text = renderFinalSetupText(
      sampleInput({
        groups: {
          tanks: [
            participant({
              discordUserId: "111",
              userName: "PriestTank",
              wowClass: "PRIEST",
              classLabel: "Priest",
              participationType: "BOOSTER",
              selectedRole: "TANK",
            }),
          ],
          healers: [],
          dps: [],
          lootbuddies: [],
        },
      }),
      { classIndicators: {} },
    );
    expect(text).toContain("<@111> Priest");
    expect(text).not.toContain("<:priest:");
  });

  it("keeps lootbuddy lines as mentions only", () => {
    const text = renderFinalSetupText(sampleInput());
    expect(text).toContain("<@222>");
    expect(text).toContain("@NoDiscord");
    expect(text).not.toMatch(/<@222> Mage/);
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
  it("shares the same plain-text body and Raid Lead footer from the formatter", () => {
    const input = sampleInput({ raidLeadDisplayName: "Kiri" });
    const shared = formatFinalSetup(input);
    const discordText = renderRunStartMessageText(sampleEmbedData({ raidLeadDisplayName: "Kiri" }));
    expect(discordText).toBe(renderFinalSetupText(input));
    expect(discordText).toContain(`**${shared.title}**`);
    expect(discordText).toContain(shared.body);
    expect(discordText.endsWith(formatFinalSetupLfgLine("Kiri"))).toBe(true);
  });
});

describe("Final Setup Discord length safety", () => {
  it("keeps a full 2/4/14 + 5 lootbuddy roster with a max-length Raid Lead under Discord's 2000-char content limit", () => {
    // Realistic worst case: 19-digit Discord snowflakes for every mention and
    // custom emoji, and a 32-char Raid Lead name (Discord's display-name /
    // username cap; the Run channel nickname is capped lower, at 24).
    const snowflake = (n: number) => `13${String(n).padStart(17, "0")}`;
    const longestRaidLead = "R".repeat(32);
    const classes: WowClass[] = [
      "WARRIOR",
      "PALADIN",
      "DEATH_KNIGHT",
      "DRUID",
      "MONK",
      "PRIEST",
      "SHAMAN",
      "MAGE",
      "WARLOCK",
      "HUNTER",
      "ROGUE",
      "DEMON_HUNTER",
      "EVOKER",
    ];
    const indicators: Partial<Record<WowClass, string>> = {};
    for (const [i, wowClass] of classes.entries()) {
      indicators[wowClass] = `<:${wowClass.toLowerCase()}:${snowflake(900 + i)}>`;
    }

    const tanks = Array.from({ length: 2 }, (_, i) =>
      participant({
        discordUserId: snowflake(10_000 + i),
        userName: `Tank${i}`,
        wowClass: "WARRIOR",
        participationType: "BOOSTER",
        selectedRole: "TANK",
      }),
    );
    const healers = Array.from({ length: 4 }, (_, i) =>
      participant({
        discordUserId: snowflake(20_000 + i),
        userName: `Heal${i}`,
        wowClass: "PRIEST",
        participationType: "BOOSTER",
        selectedRole: "HEALER",
      }),
    );
    const dps = Array.from({ length: 14 }, (_, i) =>
      participant({
        discordUserId: snowflake(30_000 + i),
        userName: `Dps${i}`,
        wowClass: classes[i % classes.length]!,
        participationType: "BOOSTER",
        selectedRole: "DPS",
      }),
    );
    const lootbuddies = Array.from({ length: 5 }, (_, i) =>
      participant({
        discordUserId: snowflake(40_000 + i),
        userName: `Loot${i}`,
        participationType: "LOOTBUDDY",
      }),
    );

    const text = renderFinalSetupText(
      sampleInput({
        raidLeadDisplayName: longestRaidLead,
        targets: { tanks: 2, healers: 4, dps: 14 },
        groups: { tanks, healers, dps, lootbuddies },
      }),
      { classIndicators: indicators },
    );

    expect(text.length).toBeLessThan(2000);
    expect(text.endsWith(formatFinalSetupLfgLine(longestRaidLead))).toBe(true);
    expect(text).toContain("🛡 **Tanks** 🛡 2/2");
    expect(text).toContain("✚ **Healers** ✚ 4/4");
    expect(text).toContain("⚔ **DPS** ⚔ 14/14");
    expect(text).toContain("📦 **Lootbuddies** 📦 5");
  });
});
