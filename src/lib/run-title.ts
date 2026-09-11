import { DEFAULT_TIME_ZONE, zonedParts } from "@/lib/datetime";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

export type BuildRunTitleInput = {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  totalBossCount: number;
  raidLeadName: string;
  timeZone?: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Server-side title authority. `{weekday} {HH:mm} {difficulty} {lootType} {planned}/{total} {raidLead}`,
 * e.g. "Thu 21:00 HC VIP 7/9 Titan". The client never sends a title — this is
 * always recomputed from the final, normalized field values.
 */
export function buildRunTitle(input: BuildRunTitleInput): string {
  const parts = zonedParts(new Date(input.scheduledStartAt), input.timeZone ?? DEFAULT_TIME_ZONE);
  const weekday = parts.weekday;
  const hhmm = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const difficulty = DIFFICULTY_ABBREVIATIONS[input.difficulty];
  const lootType = RUN_LOOT_TYPE_LABELS[input.lootType];
  const bossCoverage = `${input.plannedBossCount}/${input.totalBossCount}`;

  return `${weekday} ${hhmm} ${difficulty} ${lootType} ${bossCoverage} ${input.raidLeadName}`;
}
