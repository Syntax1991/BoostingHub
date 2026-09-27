import type { ConsumableCategory } from "@/lib/consumable-catalog";

/** Fight-relative clock, e.g. 222_000 → "03:42"; pre-pull → "-00:02"; ≥ 1h → "1:02:05". */
export function formatFightClock(ms: number): string {
  if (ms < 0) return `-${formatFightClock(-ms)}`;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

const SHORT_POTION_LABEL: Partial<Record<ConsumableCategory, string>> = {
  DAMAGE_POTION: "Damage",
  MANA_POTION: "Mana",
};

/** "Damage · 2x", "Mana · 1x", "Damage 1x · Mana 1x", or "None". */
export function summarizeCombatPotionUses(uses: ReadonlyArray<{ category: ConsumableCategory }>): string {
  const counts = new Map<ConsumableCategory, number>();
  for (const use of uses) counts.set(use.category, (counts.get(use.category) ?? 0) + 1);
  const parts = (["DAMAGE_POTION", "MANA_POTION"] as const)
    .filter((category) => counts.has(category))
    .map((category) => ({ label: SHORT_POTION_LABEL[category]!, count: counts.get(category)! }));
  if (parts.length === 0) return "None";
  if (parts.length === 1) return `${parts[0]!.label} · ${parts[0]!.count}x`;
  return parts.map((part) => `${part.label} ${part.count}x`).join(" · ");
}

export const CONSUMABLE_AUDIT_FAILURE_LABELS = {
  NOT_CONFIGURED: "Warcraft Logs API is not configured on this server.",
  REPORT_NOT_FOUND: "The linked Warcraft Logs report was not found or is private.",
  NO_RELEVANT_FIGHTS: "The report has no boss fights for this run's raid content and difficulty.",
  WCL_UNAVAILABLE: "Warcraft Logs was unavailable during the last attempt.",
} as const;

export const CONSUMABLE_AUDIT_MATCH_LABELS = {
  MATCHED: "Matched",
  NOT_IN_LOG: "Log data unavailable — character not found in this report",
  NO_CHARACTER_IDENTITY: "Log data unavailable — no character identity to match (external booster)",
} as const;
