import { describe, expect, it } from "vitest";
import {
  contentLockoutsNeedAttention,
  formatContentLockoutLines,
  projectRunContentLockouts,
} from "@/lib/run-content-lockouts";
import { formatCompactMultiRaidLockoutProgress } from "@/lib/lockout-display";
import { projectRunContentDisplay } from "@/lib/run-content-presets";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";
import { buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { formatFinalSetup, renderFinalSetupText } from "@/lib/run-start-message";
import { emptySignupEmbedMembers } from "@/discord-bot/embeds/signup-embed";

const tidebound = {
  raidId: TIDEBOUND_GROTTO_RAID_ID,
  raidName: "The Tidebound Grotto",
  sortOrder: 1,
  plannedBossCount: 1,
  totalBossCount: 1,
};

const venomous = {
  raidId: VENOMOUS_ABYSS_RAID_ID,
  raidName: "The Venomous Abyss",
  sortOrder: 2,
  plannedBossCount: 8,
  totalBossCount: 8,
};

describe("run content lockout projection", () => {
  it("projects Bundle lockouts as two segments, never 4/9", () => {
    const rows = projectRunContentLockouts({
      contents: [tidebound, venomous],
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      findSave: (content) => {
        if (content.raidId === TIDEBOUND_GROTTO_RAID_ID) {
          return {
            raidId: content.raidId,
            difficulty: "HEROIC",
            resetIdentifier: "2026-W12",
            bossesDefeated: 1,
            totalBossCount: 1,
            isComplete: true,
          };
        }
        return {
          raidId: content.raidId,
          difficulty: "HEROIC",
          resetIdentifier: "2026-W12",
          bossesDefeated: 3,
          totalBossCount: 8,
          isComplete: false,
        };
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.raidName).toBe("Nymrissa");
    expect(rows[0]!.label.text).toContain("1/1");
    expect(rows[1]!.raidName).toBe("The Venomous Abyss");
    expect(rows[1]!.label.text).toContain("3/8");
    const joined = formatContentLockoutLines(rows).join(" · ");
    expect(joined).not.toMatch(/4\/9|9\/9/);
    expect(contentLockoutsNeedAttention(rows)).toBe(true);
  });

  it("keeps Unknown Tidebound independent of Venomous Unsaved", () => {
    const rows = projectRunContentLockouts({
      contents: [tidebound, { ...venomous, plannedBossCount: 6 }],
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      findSave: (content) => {
        if (content.raidId === TIDEBOUND_GROTTO_RAID_ID) return null;
        return {
          raidId: content.raidId,
          difficulty: "HEROIC",
          resetIdentifier: "2026-W12",
          bossesDefeated: 0,
          totalBossCount: 8,
          isComplete: false,
        };
      },
    });

    expect(rows[0]!.label.text).toMatch(/\?\/1|Unknown/);
    expect(rows[1]!.label.text).toContain("0/8");
    expect(formatContentLockoutLines(rows).join(" ")).not.toContain("9/9");
  });
});

describe("multi-raid character lockout compact display", () => {
  it("groups per raid and never merges boss totals", () => {
    const text = formatCompactMultiRaidLockoutProgress(
      [
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "The Tidebound Grotto",
        difficulty: "HEROIC",
        bossesDefeated: 1,
        bossTotal: 1,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        difficulty: "HEROIC",
        bossesDefeated: 3,
        bossTotal: 8,
      },
      ],
      [
        { id: VENOMOUS_ABYSS_RAID_ID, name: "The Venomous Abyss" },
        { id: TIDEBOUND_GROTTO_RAID_ID, name: "Nymrissa" },
      ],
    );

    expect(text).toContain("Nymrissa:");
    expect(text).toContain("The Venomous Abyss:");
    expect(text).toContain("1/1");
    expect(text).toContain("3/8");
    expect(text).not.toMatch(/4\/9|9\/9/);
  });
});

describe("Discord Bundle content labels", () => {
  const display = projectRunContentDisplay([tidebound, venomous]);

  it("signup embed shows Season 2 Bundle + Raid Lead (no Content field), one message", () => {
    const embed = buildSignupEmbed({
      runId: "r1",
      runTitle: "Bundle Run",
      raidName: display.productLabel,
      productLabel: display.productLabel,
      contentSummary: display.summary,
      titleCoverage: display.titleCoverage,
      raidLeadName: "Titan",
      raidLeadDiscordUserId: "111",
      difficulty: "HEROIC",
      lootType: "VIP",
      scheduledStartAt: "2026-09-18T17:00:00.000Z",
      runStatus: "OPEN",
      signupWindowOpen: true,
      uniqueSignupCount: 1,
      roleStatus: {
        tank: { signed: 0, picked: 0, target: 2 },
        healer: { signed: 0, picked: 0, target: 4 },
        dps: { signed: 0, picked: 0, target: 14 },
        lootbuddy: { signed: 0, picked: 0 },
      },
      members: {
        signed: emptySignupEmbedMembers(),
        picked: emptySignupEmbedMembers(),
      },
      discordRolePing: true,
    }).toJSON();

    expect(embed.description).toContain("Season 2 Bundle");
    expect(embed.fields?.find((field) => field.name === "Content")).toBeUndefined();
    expect(embed.fields?.find((field) => field.name?.includes("Raid Lead"))?.value).toBe("<@111>");
    expect(display.titleCoverage).toBe("9/9");
    expect(display.channelCoverage).toBe("9of9");
    // Embed keeps product label + per-raid summary elsewhere; compact 9/9 is title/channel only.
    expect(embed.description).not.toMatch(/S2B|s2b/);
  });

  it("roster embed identifies Bundle once with content summary", () => {
    const embed = buildRosterEmbed({
      runId: "r1",
      runTitle: "Bundle Run",
      raidName: "The Venomous Abyss",
      productLabel: display.productLabel,
      contentSummary: display.summary,
      difficulty: "HEROIC",
      publishedAt: "2026-09-18T12:00:00.000Z",
      version: 1,
      targets: { tanks: 2, healers: 4 },
      groups: { tanks: [], healers: [], meleeDps: [], rangedDps: [], lootbuddies: [] },
      totalSelected: 0,
    }).toJSON();

    expect(embed.description).toContain("Season 2 Bundle");
    expect(embed.description).toContain("Nymrissa 1/1 · The Venomous Abyss 8/8");
  });

  it("Final Setup remains one message with Bundle product header", () => {
    const input = {
      raidName: "The Venomous Abyss",
      productLabel: display.productLabel,
      contentSummary: display.summary,
      difficulty: "HEROIC" as const,
      lootType: "UNSAVED" as const,
      targets: { tanks: 1, healers: 1, dps: 1 },
      groups: { tanks: [], healers: [], dps: [], lootbuddies: [] },
    };
    const message = formatFinalSetup(input);
    expect(message.body).toContain("**Season 2 Bundle**");
    expect(message.body).toContain("Nymrissa 1/1 · The Venomous Abyss 8/8");
    const text = renderFinalSetupText(input);
    expect(text.startsWith("**Final Setup**")).toBe(true);
    expect(text.match(/\*\*Final Setup\*\*/g)).toHaveLength(1);
  });
});
