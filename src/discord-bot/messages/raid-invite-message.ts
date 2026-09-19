import { zonedParts } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  RUN_LOOT_TYPE_LABELS,
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
  guildName: string;
  runChannelId: string;
};

/** Apex-style `16/09/2026 15:30` in Europe/Berlin. */
export function formatRaidInviteSchedule(scheduledStartAt: string): string {
  const parts = zonedParts(new Date(scheduledStartAt), "Europe/Berlin");
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const mi = String(parts.minute).padStart(2, "0");
  return `${dd}/${mm}/${parts.year} ${hh}:${mi}`;
}

/**
 * Assignment line body (without the `Assignment:` prefix / outer bold).
 * BOOSTER: `Healer - Synmist (Monk) VIP`
 * LOOTBUDDY: `Lootbuddy - (Monk) VIP` or `Lootbuddy - VIP` when class unknown.
 */
export function formatRaidInviteAssignment(input: {
  participationType: "BOOSTER" | "LOOTBUDDY";
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
  lootType: RunLootType;
}): string {
  const lootTag = RUN_LOOT_TYPE_LABELS[input.lootType];
  const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;

  if (input.participationType === "LOOTBUDDY") {
    if (classLabel) return `Lootbuddy - (${classLabel}) ${lootTag}`;
    return `Lootbuddy - ${lootTag}`;
  }

  const roleLabel = input.selectedRole ? CHARACTER_ROLE_LABELS[input.selectedRole] : "Booster";
  const name = input.characterName?.trim() || "Unknown";
  if (classLabel) return `${roleLabel} - ${name} (${classLabel}) ${lootTag}`;
  return `${roleLabel} - ${name} ${lootTag}`;
}

/**
 * Plain-text Apex-style Raid Invite DM content.
 */
export function buildRaidInviteMessage(input: RaidInviteMessageInput): string {
  const when = formatRaidInviteSchedule(input.scheduledStartAt);
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const lootHeader = input.lootType.toLowerCase();
  const assignment = formatRaidInviteAssignment(input);

  return [
    "📢 **Raid Invite**",
    `**${input.productLabel}** - ${when} - ${difficulty} - ${lootHeader}`,
    `Assignment: **${assignment}**`,
    `Channel: ${input.guildName} · <#${input.runChannelId}>`,
    "Please be online 10 minutes before start.",
  ].join("\n");
}
