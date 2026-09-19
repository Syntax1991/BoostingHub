import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

export type BuildRunTitleInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Compact content coverage from `projectRunContentDisplay(...).titleCoverage`. */
  titleCoverage: string;
  raidLeadName: string;
  timeZone?: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Server-side title authority.
 * `{weekday} {HH:mm} {difficulty} {lootType} {titleCoverage} {raidLead}`
 * e.g. "Thu 21:00 HC VIP 8/8 Titan" or "Thu 21:00 HC VIP 9/9 Titan" (Bundle).
 */
export function buildRunTitle(input: BuildRunTitleInput): string {
  const parts = zonedParts(new Date(input.scheduledStartAt), input.timeZone ?? DEFAULT_TIME_ZONE);
  const weekday = parts.weekday;
  const hhmm = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const difficulty = DIFFICULTY_ABBREVIATIONS[input.difficulty];
  const lootType = RUN_LOOT_TYPE_LABELS[input.lootType];

  return `${weekday} ${hhmm} ${difficulty} ${lootType} ${input.titleCoverage} ${input.raidLeadName}`;
}
