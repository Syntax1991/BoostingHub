import { zonedParts } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
} from "@/lib/labels";
import type { CharacterRole, RaidDifficulty, RunLootType, WowClass } from "@/models/enums";

export type RaidInviteMessageInput = {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  participationType: "BOOSTER" | "LOOTBUDDY";
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
  /** Persisted `RunDiscordPost.runChannelId` — omit Channel line when null/empty. */
  runChannelId: string | null;
};

/** `16/09/2026 15:30` in Europe/Berlin. */
export function formatRaidInviteSchedule(scheduledStartAt: string): string {
  const parts = zonedParts(new Date(scheduledStartAt), "Europe/Berlin");
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const mi = String(parts.minute).padStart(2, "0");
  return `${dd}/${mm}/${parts.year} ${hh}:${mi}`;
}

/**
 * Assignment line body (without the `Assignment:` prefix).
 * BOOSTER VIP: `Healer · Synmist (Monk) · VIP`
 * BOOSTER non-VIP: `Healer · Synmist (Monk)` (no VIP marker)
 * LOOTBUDDY VIP: `Lootbuddy · (Monk) · VIP`
 */
export function formatRaidInviteAssignment(input: {
  participationType: "BOOSTER" | "LOOTBUDDY";
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
  lootType: RunLootType;
}): string {
  const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;
  const vipSuffix = input.lootType === "VIP" ? " · VIP" : "";

  if (input.participationType === "LOOTBUDDY") {
    if (classLabel) return `Lootbuddy · (${classLabel})${vipSuffix}`;
    return `Lootbuddy${vipSuffix}`;
  }

  const roleLabel = input.selectedRole ? CHARACTER_ROLE_LABELS[input.selectedRole] : "Booster";
  const name = input.characterName?.trim() || "Unknown";
  if (classLabel) return `${roleLabel} · ${name} (${classLabel})${vipSuffix}`;
  return `${roleLabel} · ${name}${vipSuffix}`;
}

/**
 * Raid Invite DM body. Channel line uses a real `<#id>` mention only when
 * `runChannelId` is set — never invents `#unknown` / guild prefixes.
 */
export function buildRaidInviteMessage(input: RaidInviteMessageInput): string {
  const when = formatRaidInviteSchedule(input.scheduledStartAt);
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const assignment = formatRaidInviteAssignment(input);
  const channelId = input.runChannelId?.trim() || null;

  const lines = [
    "📣 **Raid Invite**",
    "",
    input.productLabel,
    `${when} · ${difficulty}`,
    "",
    `Assignment: ${assignment}`,
  ];

  if (channelId) {
    lines.push(`Channel: <#${channelId}>`);
  }

  lines.push("", "Please be online 10 minutes before start.");
  return lines.join("\n");
}
