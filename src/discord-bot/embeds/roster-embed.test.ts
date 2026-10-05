import { afterEach, describe, expect, it, vi } from "vitest";
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
  targets: { tanks: 2, healers: 4, dps: 14, lootbuddies: 0 },
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
    unspecifiedDps: [],
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

  it("renders an external booster as @name + class, never a mention", () => {
    const external = {
      userId: "external:1",
      userName: "dawn",
      discordUserId: null,
      characterName: "dawn",
      characterRealm: "",
      wowClass: "MAGE" as const,
      external: true,
    };
    expect(formatRosterParticipantLine(external, { MAGE: "<:mage:9>" })).toBe("@dawn <:mage:9>");
    expect(formatRosterParticipantLine(external, {})).toBe("@dawn Mage");
  });
});

describe("buildRosterEmbed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("titles the embed Roster and keeps Tank/Healer targets with melee/ranged DPS counts", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.title).toBe("Roster");
    expect(embed.description).toContain("Weekend Heroic Catch-up");
    const byName = new Map(embed.fields?.map((field) => [field.name, field.value]));
    expect([...byName.keys()].find((name) => name?.includes("Tanks"))).toContain("(1/2)");
    expect([...byName.keys()].find((name) => name?.includes("Healers"))).toContain("(1/4)");
    expect([...byName.keys()].find((name) => name?.includes("Melee DPS"))).toContain("(1)");
    expect([...byName.keys()].find((name) => name?.includes("Melee DPS"))).not.toContain("/");
    expect([...byName.keys()].find((name) => name?.includes("Ranged DPS"))).toContain("(0)");
    expect(embed.footer?.text).toContain("DPS 1/14");
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

  it("omits the lootbuddies field when empty and no lootbuddy target", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.fields?.some((field) => field.name?.includes("Lootbuddies"))).toBe(false);
  });

  it("always shows lootbuddies when a target is set, with picked/target", () => {
    const withTarget: RosterEmbedData = {
      ...data,
      targets: { ...data.targets, lootbuddies: 3 },
      groups: { ...data.groups, lootbuddies: [] },
    };
    const embed = buildRosterEmbed(withTarget).toJSON();
    const field = embed.fields?.find((row) => row.name?.includes("Lootbuddies"));
    expect(field?.name).toContain("(0/3)");
    expect(field?.value).toBe("—");
  });

  it("includes a lootbuddies field when members are present", () => {
    const withLoot: RosterEmbedData = {
      ...data,
      targets: { ...data.targets, lootbuddies: 2 },
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
      totalSelected: 4,
    };
    const embed = buildRosterEmbed(withLoot).toJSON();
    expect(embed.fields?.some((field) => field.name?.startsWith("📦 Lootbuddies (1/2)"))).toBe(true);
  });

  it("reports selected/DPS targets and version in the footer", () => {
    const embed = buildRosterEmbed(data).toJSON();
    expect(embed.footer?.text).toBe("Published · Selected 3 · DPS 1/14 · Roster version 3");
  });

  it("shows an empty-state when nobody is selected yet", () => {
    const empty: RosterEmbedData = {
      ...data,
      publishedAt: null,
      totalSelected: 0,
      groups: { tanks: [], healers: [], meleeDps: [], rangedDps: [], unspecifiedDps: [], lootbuddies: [] },
    };
    const embed = buildRosterEmbed(empty).toJSON();
    expect(embed.footer?.text).toContain("Draft");
    expect(embed.fields?.every((field) => field.value === "No players selected yet.")).toBe(true);
  });

  it("links the Run title in the description, not the Roster embed title", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
    const embed = buildRosterEmbed({
      ...data,
      runId: "run-123",
      runTitle: "Mon 19:30 HC VIP 7/9 Nyxara",
    }).toJSON();
    expect(embed.title).toBe("Roster");
    expect(embed.url).toBeUndefined();
    expect(embed.description?.split("\n")[0]).toBe(
      "[Mon 19:30 HC VIP 7/9 Nyxara](https://example.test/runs/run-123)",
    );
  });

  it("does not double a trailing slash on the application origin in the Run title link", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test/");
    const embed = buildRosterEmbed({
      ...data,
      runId: "run-123",
      runTitle: "Mon 19:30 HC VIP 7/9 Nyxara",
    }).toJSON();
    expect(embed.url).toBeUndefined();
    expect(embed.description?.split("\n")[0]).toBe(
      "[Mon 19:30 HC VIP 7/9 Nyxara](https://example.test/runs/run-123)",
    );
  });

  it("still builds the embed with a plain Run title when production has no base URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const embed = buildRosterEmbed({
      ...data,
      runId: "run-123",
      runTitle: "Mon 19:30 HC VIP 7/9 Nyxara",
    }).toJSON();
    expect(embed.title).toBe("Roster");
    expect(embed.url).toBeUndefined();
    expect(embed.description?.split("\n")[0]).toBe("Mon 19:30 HC VIP 7/9 Nyxara");
    expect(embed.description).not.toContain("](");
  });
});
