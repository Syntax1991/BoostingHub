import type { RaidDifficulty } from "@/models/enums";
import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";

/**
 * Discord raid-channel naming: `{weekday}-{HHMM}-{difficulty}-{runType}-{progress}-{raidLead}`
 * (e.g. `sat-2300-hc-vip-7of9-titan`), all computed from authoritative Run
 * data — never a raw concatenation of user-provided strings.
 *
 * `runType` (e.g. "vip") and `progress` (e.g. "7of9") have no home in the
 * current Run domain — there is no product/type field and no persisted
 * boss-progression field on Run. Rather than inventing schema for channel
 * cosmetics, this builder omits those segments when not supplied and
 * produces the reduced `{weekday}-{HHMM}-{difficulty}-{raidLead}` form
 * (e.g. `sat-2300-hc-titan`). If those fields are added to the domain
 * later, pass them through unchanged — no change needed here.
 */
export type RunChannelNameInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  raidLeadName: string;
  runType?: string;
  progress?: string;
  timeZone?: string;
};

/**
 * All three difficulties intentionally reduce to two characters for a
 * visually consistent channel list. If the community actually uses a
 * different Mythic shorthand, change only this one map.
 */
const DIFFICULTY_ABBREVIATIONS: Record<RaidDifficulty, string> = {
  NORMAL: "nm",
  HEROIC: "hc",
  MYTHIC: "my",
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
  const difficulty = DIFFICULTY_ABBREVIATIONS[input.difficulty];
  const runType = input.runType ? slugSegment(input.runType) : "";
  const progress = input.progress ? slugSegment(input.progress) : "";
  const raidLead = slugSegment(input.raidLeadName);

  const segments = [weekday, hhmm, difficulty, runType, progress, raidLead].filter((segment) => segment.length > 0);
  return trimHyphens(segments.join("-")).slice(0, MAX_CHANNEL_NAME_LENGTH);
}
