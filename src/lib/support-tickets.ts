import { slugDiscordChannelSegment } from "@/lib/discord-channel-name";
import { SUPPORT_TICKET_TYPES, type SupportTicketType } from "@/models/enums";

/**
 * Pure Support-ticket rules shared by the Bot API service and the Discord
 * bot process: category copy, modal field limits, Report-a-Booster parsing,
 * channel naming. No discord.js and no database access here.
 */

export type SupportTicketTypeDefinition = {
  label: string;
  emoji: string;
  description: string;
  /** Label of the optional reference field, or null when the type has none. */
  referenceLabel: string | null;
  referencePlaceholder: string | null;
};

export const SUPPORT_TICKET_TYPE_DEFINITIONS: Record<SupportTicketType, SupportTicketTypeDefinition> = {
  ADMIN_SUPPORT: {
    label: "Admin Support",
    emoji: "🛡️",
    description: "Account, community or admin problems",
    referenceLabel: null,
    referencePlaceholder: null,
  },
  RAID_SUPPORT: {
    label: "Raid Support",
    emoji: "⚔️",
    description: "Anything about a raid run",
    referenceLabel: "Run / Raid reference",
    referencePlaceholder: "Run name, Run ID, run channel or date/time",
  },
  MYTHIC_PLUS_SUPPORT: {
    label: "M+ Support",
    emoji: "🗝️",
    description: "Anything about Mythic+",
    referenceLabel: "Dungeon / Key / Run reference",
    referencePlaceholder: "Dungeon, key level or run",
  },
  GENERAL_SUPPORT: {
    label: "General Support",
    emoji: "💬",
    description: "Anything else",
    referenceLabel: null,
    referencePlaceholder: null,
  },
  REPORT_BOOSTER: {
    label: "Report a Booster",
    emoji: "🚨",
    description: "Private report about a Booster",
    referenceLabel: "Run reference",
    referencePlaceholder: "Run name, Run ID or date/time",
  },
};

export function isSupportTicketType(value: unknown): value is SupportTicketType {
  return typeof value === "string" && (SUPPORT_TICKET_TYPES as readonly string[]).includes(value);
}

/** Discord modal text limits (server re-validates the same bounds). */
export const SUPPORT_TICKET_LIMITS = {
  subjectMax: 100,
  descriptionMin: 10,
  descriptionMax: 2000,
  referenceMax: 200,
  boosterMax: 100,
  displayNameMax: 100,
} as const;

/** `#0042` — zero-padded to four digits, grows naturally beyond 9999. */
export function formatSupportTicketNumber(number: number): string {
  return String(number).padStart(4, "0");
}

/** Race-safe duplicate guard value: one active ticket per creator and type. */
export function supportTicketActiveKey(creatorDiscordUserId: string, type: SupportTicketType): string {
  return `${creatorDiscordUserId}:${type}`;
}

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DISCORD_USER_MENTION_PATTERN = /^<@!?(\d{17,20})>$/;

export function isDiscordSnowflake(value: string): boolean {
  return DISCORD_SNOWFLAKE_PATTERN.test(value);
}

export type ParsedReportedBooster = {
  /** Only set for an exact user mention or a raw Discord id — never guessed. */
  reportedDiscordUserId: string | null;
  reportedBoosterLabel: string;
};

/**
 * The Report-a-Booster "Booster" field. An exact `<@id>` / `<@!id>` mention or
 * a bare snowflake yields the Discord user id; anything else (a character or
 * display name) is kept as a label only. No member lookup or fuzzy matching:
 * a wrong guess would deny the wrong person access to the report channel.
 */
export function parseReportedBooster(raw: string): ParsedReportedBooster {
  const label = raw.trim();
  const mention = DISCORD_USER_MENTION_PATTERN.exec(label);
  if (mention) return { reportedDiscordUserId: mention[1], reportedBoosterLabel: label };
  if (isDiscordSnowflake(label)) return { reportedDiscordUserId: label, reportedBoosterLabel: label };
  return { reportedDiscordUserId: null, reportedBoosterLabel: label };
}

const MAX_CHANNEL_NAME_LENGTH = 100;

/**
 * `ticket-0042-syntax`: lower-case, Discord-safe, unique through the ticket
 * number, never derived from the Subject.
 */
export function buildSupportTicketChannelName(number: number, creatorLabel: string): string {
  const prefix = `ticket-${formatSupportTicketNumber(number)}`;
  const creator = slugDiscordChannelSegment(creatorLabel);
  if (!creator) return prefix;
  const room = MAX_CHANNEL_NAME_LENGTH - prefix.length - 1;
  const trimmed = creator.slice(0, room).replace(/-+$/g, "");
  return trimmed ? `${prefix}-${trimmed}` : prefix;
}
