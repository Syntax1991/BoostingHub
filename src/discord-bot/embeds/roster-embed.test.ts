import { describe, expect, it } from "vitest";
import type { RosterEmbedData } from "@/services/discord-sync.service";
import { buildRosterEmbed, formatRosterParticipantLine } from "@/discord-bot/embeds/roster-embed";

const data: RosterEmbedData = {
  runId: "r7777777-7777-4777-8777-777777777777",
  runTitle: "Weekend Heroic Catch-up",
  raidName: "Manaforge Omega",
  productLabel: "Manaforge Omega",
  contentSummary: "Manaforge Omega 8/8",
  difficulty: "HEROIC",
  publishedAt: "2026-09-20T20:00:00.000Z",
  version: 3,
  targets: { tanks: 2, healers: 4 },
  groups: {
    tanks: [
      {
        userId: "u1",
        userName: "Kael",
        discordUserId: "111",
        characterName: "Stormhowl",
        characterRealm: "Tarren Mill",
        wowClass: "WARRIOR",
      },
    ],
    healers: [
      {
        userId: "u2",
        userName: "Mira",
        discordUserId: null,
        characterName: "Dawnward",
        characterRealm: "Silvermoon",
        wowClass: "PRIEST",
      },
    ],
    meleeDps: [
      {
        userId: "u3",
        userName: "Brann",
        discordUserId: "333",
        characterName: "Emberforge",
        characterRealm: "Area 52",
        wowClass: "PALADIN",
      },
    ],
    rangedDps: [],
    lootbuddies: [],
  },
  totalSelected: 3,
};

describe("formatRosterParticipantLine", () => {
  it("formats mention + class emoji + Character-Realm", () => {
    expect(
      formatRosterParticipantLine(data.groups.tanks[0]!, { WARRIOR: "<:warrior:1>" }),
    ).toBe("<@111> <:warrior:1> — Stormhowl-Tarren Mill");
  });

  it("falls back to class label when guild emoji is missing", () => {
    expect(formatRosterParticipantLine(data.groups.healers[0]!, {})).toBe("Priest — Dawnward-Silvermoon");
  });
});

describe("buildRosterEmbed", () => {
  it("shows real Tank/Healer targets and a bare count for melee/ranged DPS", () => {
    const embed = buildRosterEmbed(data).toJSON();
    const byName = new Map(embed.fields?.map((field) => [field.name, field.value]));
    expect([...byName.keys()].find((name) => name?.includes("Tanks"))).toContain("(1/2)");
    expect([...byName.keys()].find((name) => name?.includes("Healers"))).toContain("(1/4)");
    expect([...byName.keys()].find((name) => name?.includes("Melee DPS"))).toContain("(1)");
    expect([...byName.keys()].find((name) => name?.includes("Melee DPS"))).not.toContain("/");
    expect([...byName.keys()].find((name) => name?.includes("Ranged DPS"))).toContain("(0)");
  });

  it("uses signup-embed role emoji fallbacks (✚ not ♻, 📦 for loot)", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.fields?.some((field) => field.name?.startsWith("🛡 Tanks"))).toBe(true);
    expect(embed.fields?.some((field) => field.name?.startsWith("✚ Healers"))).toBe(true);
    expect(embed.fields?.some((field) => field.name?.startsWith("⚔ Melee DPS"))).toBe(true);
    expect(embed.fields?.some((field) => field.name?.startsWith("⚔ Ranged DPS"))).toBe(true);
  });

  it("prefers guild custom role emojis when provided", () => {
    const embed = buildRosterEmbed(data, {
      roleIndicators: { tank: "<:tank:9>", healer: "<:healer:8>", dps: "<:dps:7>" },
    }).toJSON();
    expect(embed.fields?.some((field) => field.name?.startsWith("<:tank:9> Tanks"))).toBe(true);
    expect(embed.fields?.some((field) => field.name?.startsWith("<:healer:8> Healers"))).toBe(true);
    expect(embed.fields?.some((field) => field.name?.startsWith("<:dps:7> Melee DPS"))).toBe(true);
  });

  it("mentions a linked Discord user and falls back to Character-Realm otherwise", () => {
    const embed = buildRosterEmbed(data, {
      classIndicators: { WARRIOR: "<:warrior:1>", PRIEST: "<:priest:2>" },
    }).toJSON();
    const tanks = embed.fields?.find((field) => field.name?.includes("Tanks"))?.value ?? "";
    const healers = embed.fields?.find((field) => field.name?.includes("Healers"))?.value ?? "";
    expect(tanks).toContain("<@111>");
    expect(tanks).toContain("<:warrior:1>");
    expect(tanks).toContain("Stormhowl-Tarren Mill");
    expect(healers).not.toContain("<@");
    expect(healers).toContain("<:priest:2>");
    expect(healers).toContain("Dawnward-Silvermoon");
  });

  it("omits the lootbuddies field entirely when there are none", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.fields?.some((field) => field.name?.includes("Lootbuddies"))).toBe(false);
  });

  it("includes a lootbuddies field when present", () => {
    const withLoot: RosterEmbedData = {
      ...data,
      groups: {
        ...data.groups,
        lootbuddies: [
          {
            userId: "u4",
            userName: "Sylva",
            discordUserId: null,
            characterName: "Windchaser",
            characterRealm: "Area 52",
            wowClass: "HUNTER",
          },
        ],
      },
    };
    const embed = buildRosterEmbed(withLoot).toJSON();
    expect(embed.fields?.some((field) => field.name?.startsWith("📦 Lootbuddies"))).toBe(true);
  });

  it("reports total selected and roster version in the footer", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.footer?.text).toBe("Total selected: 3 · Roster version 3");
  });
});
