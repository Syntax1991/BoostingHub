import type { RaidDifficulty, RunLootType } from "@/models/enums";
import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";

/**
 * Discord raid-channel naming: `{weekday}-{HHMM}-{difficulty}-{lootType}-{planned}of{total}-{raidLead}`
 * (e.g. `sat-2300-hc-vip-7of9-titan`), all computed from the same structured
 * Run fields the derived title uses — never a raw concatenation of
 * user-provided strings, and never parsed from `Run.title`.
 */
export type RunChannelNameInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  totalBossCount: number;
  raidLeadName: string;
  timeZone?: string;
};

/** Discord text channel names are capped at 100 characters. */
const MAX_CHANNEL_NAME_LENGTH = 100;

// Combining diacritical marks (U+0300-U+036F), stripped after NFKD decomposition
// so e.g. an accented Latin letter reduces to its unaccented ASCII base letter.
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
  const bossCoverage = `${input.plannedBossCount}of${input.totalBossCount}`;
  const raidLead = slugSegment(input.raidLeadName);

  const segments = [weekday, hhmm, difficulty, lootType, bossCoverage, raidLead].filter(
    (segment) => segment.length > 0,
  );
  return trimHyphens(segments.join("-")).slice(0, MAX_CHANNEL_NAME_LENGTH);
}
