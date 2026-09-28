import type { ConsumableCategory } from "@/lib/consumable-catalog";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { CharacterRole } from "@/models/enums";
import type { PlayedRole } from "@/services/consumable-audit-policy";

/** Played role label: "Healer", "Mixed", "Unknown". */
export function playedRoleLabel(role: PlayedRole): string {
  if (role === "MIXED") return "Mixed";
  if (role === "UNKNOWN") return "Unknown";
  return CHARACTER_ROLE_LABELS[role];
}

/**
 * The roster role when it differs from a single played role — shown as
 * information only (never a warning). Null when they agree or cannot be compared.
 */
export function rosterRoleMismatch(player: { rosterRole: CharacterRole | null; playedRole: PlayedRole }): CharacterRole | null {
  if (!player.rosterRole || player.playedRole === "MIXED" || player.playedRole === "UNKNOWN") return null;
  return player.rosterRole === player.playedRole ? null : player.rosterRole;
}

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

/** Per-fight aura check (flask / food / rune): "Active", "Missing", "3/4", "Unknown", or "—" for an unused optional rune. */
export function auraCheckText(check: { status: string; fightsWith: number; fightsChecked: number }): string {
  if (check.status === "UNKNOWN") return "Unknown";
  if (check.status === "NEUTRAL" && check.fightsWith === 0) return "—";
  if (check.fightsChecked <= 1) return check.fightsWith > 0 ? "Active" : "Missing";
  return `${check.fightsWith}/${check.fightsChecked}`;
}

/**
 * Weapon column: what satisfied it ("Oil", "Shaman imbue", "Runeforge"),
 * "Missing" / "Missing Runeforge" (a Death Knight is never told an oil is missing),
 * "N/A" or "Unknown".
 */
export function weaponEnhancementText(check: {
  status: string;
  expected: "RUNEFORGE" | "TEMPORARY";
  labels: readonly string[];
}): string {
  if (check.status === "UNKNOWN") return "Unknown";
  if (check.status === "NA") return "N/A";
  if (check.status === "WARNING") {
    const missing = check.expected === "RUNEFORGE" ? "Missing Runeforge" : "Missing";
    return check.labels.length > 0 ? `${missing} · ${check.labels.join(", ")}` : missing;
  }
  return check.labels.join(", ") || "Present";
}

/** Enchants column: "6/7", "N/A" or "?". */
export function enchantCheckText(check: { status: string; enchanted: number; required: number }): string {
  if (check.status === "NA") return "N/A";
  if (check.required === 0) return "?";
  return `${check.enchanted}/${check.required}`;
}

/**
 * Gems column, from the actual items' sockets: "3/3", "2/3", "0 sockets", "?"
 * (socket count unavailable), or "2/2 + ?" when some items are unknown.
 */
export function gemCheckText(check: {
  status: string;
  filled: number;
  sockets: number;
  empty: readonly unknown[];
  unknown: readonly unknown[];
}): string {
  if (check.status === "NA") return "0 sockets";
  if (check.sockets === 0) return "?";
  return check.unknown.length > 0 ? `${check.filled}/${check.sockets} + ?` : `${check.filled}/${check.sockets}`;
}

/** "Neck" for a single empty socket; "Neck — 2 of 2 sockets empty" when the item has several. */
export function emptySocketText(row: { slotLabel: string; emptySockets: number; sockets: number }): string {
  return row.sockets > 1 ? `${row.slotLabel} — ${row.emptySockets} of ${row.sockets} sockets empty` : row.slotLabel;
}

/** Optional rune state — never a failure: "Present", "Present 1/2", "Absent" or "Unknown". */
export function runePresenceText(check: { fightsWith: number; fightsChecked: number }): string {
  if (check.fightsChecked === 0) return "Unknown";
  if (check.fightsWith === 0) return "Absent";
  if (check.fightsWith === check.fightsChecked) return "Present";
  return `Present ${check.fightsWith}/${check.fightsChecked}`;
}
