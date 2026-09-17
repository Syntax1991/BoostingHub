import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { RAID_DIFFICULTIES, type RaidDifficulty } from "@/models/enums";

/** Stable NORMAL → HEROIC → MYTHIC order; drops unknowns/duplicates. */
export function normalizeUnavailableDifficulties(
  difficulties: readonly RaidDifficulty[],
): RaidDifficulty[] {
  const wanted = new Set(difficulties);
  return RAID_DIFFICULTIES.filter((difficulty) => wanted.has(difficulty));
}

/**
 * Compact /characters Availability button label.
 * [] → Available; all three → Unavailable · All; else Unavailable · N + HC …
 */
export function formatWeeklyAvailabilityButtonLabel(
  unavailableDifficulties: readonly RaidDifficulty[],
): string {
  const ordered = normalizeUnavailableDifficulties(unavailableDifficulties);
  if (ordered.length === 0) return "Available";
  if (ordered.length === RAID_DIFFICULTIES.length) return "Unavailable · All";
  return `Unavailable · ${ordered.map((d) => COMPACT_DIFFICULTY_LABELS[d]).join(" + ")}`;
}

/** Character-detail prose for the current-reset availability state. */
export function formatWeeklyAvailabilityDetailSummary(
  unavailableDifficulties: readonly RaidDifficulty[],
): { headline: string; detail: string | null } {
  const ordered = normalizeUnavailableDifficulties(unavailableDifficulties);
  if (ordered.length === 0) {
    return { headline: "Available this reset", detail: null };
  }
  return {
    headline: "Unavailable this reset",
    detail: ordered.map((d) => DIFFICULTY_LABELS[d]).join(", "),
  };
}
