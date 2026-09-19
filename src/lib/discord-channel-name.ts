import type { RaidDifficulty, RunLootType } from "@/models/enums";
import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";

/**
 * Discord raid-channel naming:
 * `{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}`
 *
 * `coverage` comes from `projectRunContentDisplay(...).channelCoverage`
 * (e.g. `8of8` or Bundle `9of9`) — never from singular Run.plannedBossCount.
 */
export type RunChannelNameInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Content-native coverage token (`8of8`, `9of9`, …). */
  coverage: string;
  raidLeadName: string;
  timeZone?: string;
};

/** Discord text channel names are capped at 100 characters. */
const MAX_CHANNEL_NAME_LENGTH = 100;

const COMBINING_MARKS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

function slugSegment(value: string): string {
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
  const weekday = slugSegment(parts.weekday);
  const hhmm = `${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}`;
  const difficulty = DIFFICULTY_ABBREVIATIONS[input.difficulty].toLowerCase();
  const lootType = input.lootType.toLowerCase();
  const bossCoverage = slugSegment(input.coverage);
  const raidLead = slugSegment(input.raidLeadName);

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
