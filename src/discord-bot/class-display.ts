import type { WowClass } from "@/models/enums";
import { CLASS_LABELS } from "@/lib/labels";

/**
 * Optional Discord custom emoji strings for Final Setup class indicators.
 * Leave empty until real guild emoji IDs are configured — never invent IDs.
 * Example value shape: "<:deathknight:1234567890>"
 */
export const CLASS_DISCORD_EMOJIS: Partial<Record<WowClass, string>> = {
  // Intentionally empty. Populate with real custom emoji markup when available.
};

/** Prefer a configured Discord class emoji; otherwise the human class label. */
export function classIndicator(wowClass: WowClass | null, classLabel: string | null): string | null {
  if (wowClass) {
    const emoji = CLASS_DISCORD_EMOJIS[wowClass];
    if (emoji) return emoji;
    return CLASS_LABELS[wowClass];
  }
  return classLabel;
}
