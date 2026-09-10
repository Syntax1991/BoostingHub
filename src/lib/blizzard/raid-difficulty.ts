import type { RaidDifficulty } from "@/models/enums";

/**
 * Map Blizzard Character Raids difficulty.type values to BoostingHub difficulties.
 * LFR and legacy difficulties are intentionally ignored for v1.
 */
export function mapBlizzardRaidDifficulty(type: string | null | undefined): RaidDifficulty | null {
  if (!type) return null;
  const normalized = type.trim().toUpperCase();
  if (normalized === "NORMAL") return "NORMAL";
  if (normalized === "HEROIC") return "HEROIC";
  if (normalized === "MYTHIC") return "MYTHIC";
  return null;
}

export const COMPACT_DIFFICULTY_LABELS: Record<RaidDifficulty, string> = {
  NORMAL: "N",
  HEROIC: "HC",
  MYTHIC: "M",
};
