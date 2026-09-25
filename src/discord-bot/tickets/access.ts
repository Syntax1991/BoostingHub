import { OverwriteType, PermissionFlagsBits } from "discord.js";
import type { BotTicketEnv } from "@/discord-bot/env";
import type { SupportTicketType } from "@/models/enums";

/**
 * Staff access matrix, from configured role ids only (never role names).
 * Raid Staff / M+ Staff deliberately do not see Report-a-Booster tickets.
 */
export function staffRoleIdsForTicketType(type: SupportTicketType, env: BotTicketEnv): string[] {
  switch (type) {
    case "ADMIN_SUPPORT":
      return [env.adminRoleId];
    case "RAID_SUPPORT":
      return [env.raidStaffRoleId, env.adminRoleId];
    case "MYTHIC_PLUS_SUPPORT":
      return [env.mythicPlusStaffRoleId, env.adminRoleId];
    case "GENERAL_SUPPORT":
    case "REPORT_BOOSTER":
      return [env.moderatorRoleId, env.adminRoleId];
  }
}

/**
 * Role ids of the interaction member as Discord delivered them — a cached
 * GuildMember (`roles.cache`) or a raw API member (`roles: string[]`).
 * Anything else yields no roles (deny by default).
 */
export function extractMemberRoleIds(member: unknown): string[] {
  if (!member || typeof member !== "object") return [];
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) return roles.filter((role): role is string => typeof role === "string");
  if (roles && typeof roles === "object" && "cache" in roles) {
    const cache = (roles as { cache: { keys(): Iterable<string> } }).cache;
    return [...cache.keys()];
  }
  return [];
}

/**
 * Who may close a ticket: its creator, or a member currently holding one of
 * the Staff roles for the ticket's type. `actorRoleIds` must come from the
 * Discord interaction member — never from a custom id or user input.
 */
export function canCloseTicket(input: {
  ticket: { type: SupportTicketType; creatorDiscordUserId: string };
  actorDiscordUserId: string;
  actorRoleIds: readonly string[];
  env: BotTicketEnv;
}): boolean {
  if (input.actorDiscordUserId === input.ticket.creatorDiscordUserId) return true;
  const allowed = new Set(staffRoleIdsForTicketType(input.ticket.type, input.env));
  return input.actorRoleIds.some((roleId) => allowed.has(roleId));
}

export type TicketPermissionOverwrite = {
  id: string;
  type: OverwriteType;
  allow: bigint[];
  deny: bigint[];
};

const PARTICIPANT_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

const BOT_ALLOW = [...PARTICIPANT_ALLOW, PermissionFlagsBits.ManageChannels];

/**
 * Private ticket channel overwrites. Explicit on every principal so nothing
 * depends on what the ticket category happens to inherit:
 * - @everyone (role id = guild id): deny View Channel
 * - creator + the type's Staff roles: participate
 * - the bot member: participate + Manage Channels (to delete on close)
 * - Report a Booster with a known Discord id: explicit deny for the reported
 *   user (defense in depth; a Discord Administrator bypasses all overwrites).
 */
export function buildTicketPermissionOverwrites(input: {
  guildId: string;
  botUserId: string;
  creatorDiscordUserId: string;
  staffRoleIds: readonly string[];
  reportedDiscordUserId?: string | null;
}): TicketPermissionOverwrite[] {
  const overwrites: TicketPermissionOverwrite[] = [
    { id: input.guildId, type: OverwriteType.Role, allow: [], deny: [PermissionFlagsBits.ViewChannel] },
    { id: input.creatorDiscordUserId, type: OverwriteType.Member, allow: [...PARTICIPANT_ALLOW], deny: [] },
    ...[...new Set(input.staffRoleIds)].map((roleId) => ({
      id: roleId,
      type: OverwriteType.Role,
      allow: [...PARTICIPANT_ALLOW],
      deny: [],
    })),
    { id: input.botUserId, type: OverwriteType.Member, allow: [...BOT_ALLOW], deny: [] },
  ];
  const reported = input.reportedDiscordUserId;
  if (reported && reported !== input.creatorDiscordUserId && reported !== input.botUserId) {
    overwrites.push({ id: reported, type: OverwriteType.Member, allow: [], deny: [PermissionFlagsBits.ViewChannel] });
  }
  return overwrites;
}
