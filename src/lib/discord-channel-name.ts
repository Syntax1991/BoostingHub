import type { RaidDifficulty, RunLootType } from "@/models/enums";
import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";

/**
 * Discord raid-channel naming:
 * `{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}`
 *
 * `coverage` comes from `projectRunContentDisplay(...).channelCoverage`
 * (e.g. `8of8` or Bundle `9of9`) — never from singular Run.plannedBossCount.
 *
 * `raidLeadChannelName` is the Raid Lead segment source (nickname or User.name).
 * It never comes from Discord guild nicknames or Run.title.
 */
export type RunChannelNameInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Content-native coverage token (`8of8`, `9of9`, …). */
  coverage: string;
  /** Effective Raid Lead channel-name segment (nickname ?? User.name). */
  raidLeadChannelName: string;
  timeZone?: string;
};

/** Discord text channel names are capped at 100 characters. */
const MAX_CHANNEL_NAME_LENGTH = 100;

/** Max raw length for Settings `discordRunChannelNickname` before slugifying. */
export const DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH = 24;

const COMBINING_MARKS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Shared slug semantics for Discord Run channel segments and nickname validation.
 * Empty result means the input cannot form a channel segment.
 */
export function slugDiscordChannelSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimHyphens(value: string): string {
  return value.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/** Pure, deterministic, and safe against unsupported characters in any segment. */
export function buildDiscordRunChannelName(input: RunChannelNameInput): string {
  const parts = zonedParts(new Date(input.scheduledStartAt), input.timeZone ?? DEFAULT_TIME_ZONE);
  const weekday = slugDiscordChannelSegment(parts.weekday);
  const hhmm = `${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}`;
  const difficulty = DIFFICULTY_ABBREVIATIONS[input.difficulty].toLowerCase();
  const lootType = input.lootType.toLowerCase();
  const bossCoverage = slugDiscordChannelSegment(input.coverage);
  const raidLead = slugDiscordChannelSegment(input.raidLeadChannelName);

  const segments = [weekday, hhmm, difficulty, lootType, bossCoverage, raidLead].filter(
    (segment) => segment.length > 0,
  );
  return trimHyphens(segments.join("-")).slice(0, MAX_CHANNEL_NAME_LENGTH);
}

/**
 * App-archive channel name: `closed-` + the live run-channel slug, still within
 * Discord's 100-character limit (prefix reserved so the live slug is truncated).
 */
export function buildClosedDiscordRunChannelName(input: RunChannelNameInput): string {
  const prefix = "closed-";
  const live = buildDiscordRunChannelName(input);
  const budget = MAX_CHANNEL_NAME_LENGTH - prefix.length;
  const body = live.slice(0, budget).replace(/-+$/g, "");
  return `${prefix}${body}`;
}

/** Prefer nickname when set; otherwise BoostingHub User.name. Never Discord guild nick. */
/** Discord channel names are 1–100 characters. */
export const DISCORD_CHANNEL_NAME_MAX = 100;
const RUN_VOICE_CHANNEL_PREFIX = "Raid with ";

function isControlOrLineBreak(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029;
}

/**
 * Human-readable name for a Run's temporary GuildVoice channel:
 * `Raid with <effective Raid Lead>` (see `effectiveRaidLeadChannelName`).
 * Not a text-channel slug. Control characters and line breaks become spaces,
 * whitespace collapses, and the Raid Lead part is cut (by code point) so the
 * whole name fits Discord's 100-character limit.
 */
export function formatRunVoiceChannelName(raidLeadDisplayName: string): string {
  const cleaned = Array.from(raidLeadDisplayName, (char) => (isControlOrLineBreak(char.codePointAt(0)!) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const room = DISCORD_CHANNEL_NAME_MAX - RUN_VOICE_CHANNEL_PREFIX.length;
  const lead = Array.from(cleaned).slice(0, room).join("").trim();
  return `${RUN_VOICE_CHANNEL_PREFIX}${lead}`.trim();
}

export function effectiveRaidLeadChannelName(input: {
  raidLeadName: string;
  discordRunChannelNickname: string | null | undefined;
}): string {
  const nick = input.discordRunChannelNickname?.trim();
  return nick && nick.length > 0 ? nick : input.raidLeadName;
}
