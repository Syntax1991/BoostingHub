import { describe, expect, it } from "vitest";
import type { RosterEmbedData } from "@/services/discord-sync.service";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";

const data: RosterEmbedData = {
  runId: "r7777777-7777-4777-8777-777777777777",
  runTitle: "Weekend Heroic Catch-up",
  raidName: "Manaforge Omega",
  difficulty: "HEROIC",
  publishedAt: "2026-09-20T20:00:00.000Z",
  version: 3,
  targets: { tanks: 2, healers: 4 },
  groups: {
    tanks: [{ userId: "u1", userName: "Kael", discordUserId: "111", characterName: "Stormhowl", characterRealm: "Tarren Mill" }],
    healers: [{ userId: "u2", userName: "Mira", discordUserId: null, characterName: "Dawnward", characterRealm: "Silvermoon" }],
    meleeDps: [{ userId: "u3", userName: "Brann", discordUserId: "333", characterName: "Emberforge", characterRealm: "Area 52" }],
    rangedDps: [],
    lootbuddies: [],
  },
  totalSelected: 3,
};

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

  it("mentions a linked Discord user and falls back to Character-Realm otherwise", () => {
    const embed = buildRosterEmbed(data).toJSON();
    const tanks = embed.fields?.find((field) => field.name?.includes("Tanks"))?.value ?? "";
    const healers = embed.fields?.find((field) => field.name?.includes("Healers"))?.value ?? "";
    expect(tanks).toContain("<@111>");
    expect(tanks).toContain("Stormhowl-Tarren Mill");
    expect(healers).not.toContain("<@");
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
        lootbuddies: [{ userId: "u4", userName: "Sylva", discordUserId: null, characterName: "Windchaser", characterRealm: "Area 52" }],
      },
    };
    const embed = buildRosterEmbed(withLoot).toJSON();
    expect(embed.fields?.some((field) => field.name?.includes("Lootbuddies"))).toBe(true);
  });

  it("reports total selected and roster version in the footer", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.footer?.text).toBe("Total selected: 3 · Roster version 3");
  });
});
