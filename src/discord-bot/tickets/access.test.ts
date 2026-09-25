import { OverwriteType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  buildTicketPermissionOverwrites,
  canCloseTicket,
  extractMemberRoleIds,
  staffRoleIdsForTicketType,
} from "@/discord-bot/tickets/access";
import { BOT_ID, CREATOR_ID, GUILD_ID, REPORTED_ID, TICKET_ENV } from "@/discord-bot/tickets/ticket-test-fixtures";
import type { SupportTicketType } from "@/models/enums";

const { adminRoleId: ADMIN, moderatorRoleId: MOD, raidStaffRoleId: RAID, mythicPlusStaffRoleId: MPLUS } = TICKET_ENV;

describe("staffRoleIdsForTicketType — access matrix", () => {
  const cases: Array<[SupportTicketType, string[]]> = [
    ["ADMIN_SUPPORT", [ADMIN]],
    ["RAID_SUPPORT", [RAID, ADMIN]],
    ["MYTHIC_PLUS_SUPPORT", [MPLUS, ADMIN]],
    ["GENERAL_SUPPORT", [MOD, ADMIN]],
    ["REPORT_BOOSTER", [MOD, ADMIN]],
  ];
  it.each(cases)("%s → exact Staff roles", (type, expected) => {
    expect(staffRoleIdsForTicketType(type, TICKET_ENV)).toEqual(expected);
  });

  it("Report a Booster is never visible to Raid Staff or M+ Staff", () => {
    const roles = staffRoleIdsForTicketType("REPORT_BOOSTER", TICKET_ENV);
    expect(roles).not.toContain(RAID);
    expect(roles).not.toContain(MPLUS);
  });
});

function view(overwrite: { allow: bigint[]; deny: bigint[] } | undefined) {
  if (!overwrite) return "absent";
  if (overwrite.deny.includes(PermissionFlagsBits.ViewChannel)) return "denied";
  if (overwrite.allow.includes(PermissionFlagsBits.ViewChannel)) return "allowed";
  return "neutral";
}

describe("buildTicketPermissionOverwrites", () => {
  const participant = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];

  function build(type: SupportTicketType, reportedDiscordUserId: string | null = null) {
    const overwrites = buildTicketPermissionOverwrites({
      guildId: GUILD_ID,
      botUserId: BOT_ID,
      creatorDiscordUserId: CREATOR_ID,
      staffRoleIds: staffRoleIdsForTicketType(type, TICKET_ENV),
      reportedDiscordUserId,
    });
    return { overwrites, byId: (id: string) => overwrites.find((overwrite) => overwrite.id === id) };
  }

  it("denies @everyone View Channel", () => {
    const { byId } = build("RAID_SUPPORT");
    expect(byId(GUILD_ID)).toEqual({
      id: GUILD_ID,
      type: OverwriteType.Role,
      allow: [],
      deny: [PermissionFlagsBits.ViewChannel],
    });
  });

  it("allows the creator as a member participant", () => {
    const creator = build("RAID_SUPPORT").byId(CREATOR_ID);
    expect(creator?.type).toBe(OverwriteType.Member);
    expect(creator?.allow).toEqual(participant);
    expect(creator?.deny).toEqual([]);
  });

  it("allows the bot with Manage Channels on top", () => {
    const bot = build("GENERAL_SUPPORT").byId(BOT_ID);
    expect(bot?.type).toBe(OverwriteType.Member);
    expect(bot?.allow).toEqual([...participant, PermissionFlagsBits.ManageChannels]);
  });

  it.each([
    ["ADMIN_SUPPORT", [ADMIN], [MOD, RAID, MPLUS]],
    ["RAID_SUPPORT", [RAID, ADMIN], [MOD, MPLUS]],
    ["MYTHIC_PLUS_SUPPORT", [MPLUS, ADMIN], [MOD, RAID]],
    ["GENERAL_SUPPORT", [MOD, ADMIN], [RAID, MPLUS]],
    ["REPORT_BOOSTER", [MOD, ADMIN], [RAID, MPLUS]],
  ] as Array<[SupportTicketType, string[], string[]]>)(
    "%s: correct Staff roles allowed, wrong ones absent",
    (type, allowed, absent) => {
      const { byId, overwrites } = build(type);
      for (const roleId of allowed) {
        expect(byId(roleId)?.type).toBe(OverwriteType.Role);
        expect(byId(roleId)?.allow).toEqual(participant);
      }
      for (const roleId of absent) expect(view(byId(roleId))).toBe("absent");
      // @everyone + creator + bot + the type's Staff roles — nothing else.
      expect(overwrites).toHaveLength(3 + allowed.length);
    },
  );

  it("Report a Booster with a known id: reported user explicitly denied View Channel", () => {
    const reported = build("REPORT_BOOSTER", REPORTED_ID).byId(REPORTED_ID);
    expect(reported).toEqual({
      id: REPORTED_ID,
      type: OverwriteType.Member,
      allow: [],
      deny: [PermissionFlagsBits.ViewChannel],
    });
  });

  it("no deny overwrite without a known reported id, and never against the creator or the bot", () => {
    expect(build("REPORT_BOOSTER").overwrites).toHaveLength(5);
    expect(view(build("REPORT_BOOSTER", CREATOR_ID).byId(CREATOR_ID))).toBe("allowed");
    expect(view(build("REPORT_BOOSTER", BOT_ID).byId(BOT_ID))).toBe("allowed");
  });
});

describe("canCloseTicket", () => {
  const ticket = { type: "RAID_SUPPORT" as const, creatorDiscordUserId: CREATOR_ID };
  const other = "400000000000000077";

  it("creator may close without any role", () => {
    expect(canCloseTicket({ ticket, actorDiscordUserId: CREATOR_ID, actorRoleIds: [], env: TICKET_ENV })).toBe(true);
  });

  it("authorized Staff may close", () => {
    expect(canCloseTicket({ ticket, actorDiscordUserId: other, actorRoleIds: [RAID], env: TICKET_ENV })).toBe(true);
    expect(canCloseTicket({ ticket, actorDiscordUserId: other, actorRoleIds: [ADMIN], env: TICKET_ENV })).toBe(true);
  });

  it("unrelated users and wrong Staff roles are denied", () => {
    expect(canCloseTicket({ ticket, actorDiscordUserId: other, actorRoleIds: [], env: TICKET_ENV })).toBe(false);
    expect(canCloseTicket({ ticket, actorDiscordUserId: other, actorRoleIds: [MPLUS, MOD], env: TICKET_ENV })).toBe(false);
    const report = { type: "REPORT_BOOSTER" as const, creatorDiscordUserId: CREATOR_ID };
    expect(
      canCloseTicket({ ticket: report, actorDiscordUserId: other, actorRoleIds: [RAID, MPLUS], env: TICKET_ENV }),
    ).toBe(false);
    expect(canCloseTicket({ ticket: report, actorDiscordUserId: other, actorRoleIds: [MOD], env: TICKET_ENV })).toBe(true);
  });
});

describe("extractMemberRoleIds", () => {
  it("reads raw API members and cached GuildMembers", () => {
    expect(extractMemberRoleIds({ roles: [ADMIN, 5] })).toEqual([ADMIN]);
    expect(extractMemberRoleIds({ roles: { cache: new Map([[RAID, {}]]) } })).toEqual([RAID]);
  });

  it("denies by default for missing or unexpected shapes", () => {
    expect(extractMemberRoleIds(null)).toEqual([]);
    expect(extractMemberRoleIds({})).toEqual([]);
    expect(extractMemberRoleIds({ roles: "admin" })).toEqual([]);
  });
});
