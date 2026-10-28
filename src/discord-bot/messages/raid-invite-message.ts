import { zonedParts } from "@/lib/datetime";
import { dmLink, dmRunHeader, dmRunUrl, type DmRunContext } from "@/lib/discord-run-dm";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS } from "@/lib/labels";
import type { CharacterRole, RunLootType, WowClass } from "@/models/enums";

export type RaidInviteMessageInput = {
  run: DmRunContext;
  participationType: "BOOSTER" | "LOOTBUDDY";
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
  /** Persisted `RunDiscordPost.runChannelId` — omit Channel line when null/empty. */
  runChannelId: string | null;
  /** The Run's temporary voice channel (same-pass or persisted) — omit Voice line when null/empty. */
  voiceChannelId: string | null;
};

/** Berlin wall-clock formatting kept for tests / legacy callers. Personal DMs use Discord native timestamps. */
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
  /** null = no VIP marker (the DM's meta line already shows the Run type). */
  lootType: RunLootType | null;
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
 * Raid Invite DM body. Uses Discord native timestamps for personal localization.
 * Channel / Voice lines use real `<#id>` mentions only when their id is set.
 */
export function buildRaidInviteMessage(input: RaidInviteMessageInput): string {
  // The meta line already names the Run type (… · VIP), so VIP is not repeated on the assignment.
  const assignment = formatRaidInviteAssignment({ ...input, lootType: null });
  const channelId = input.runChannelId?.trim() || null;
  const voiceChannelId = input.voiceChannelId?.trim() || null;

  const lines = [...dmRunHeader("📣 **Raid Invite**", input.run), `Assignment: ${assignment}`];

  if (channelId) {
    lines.push(`Channel: <#${channelId}>`);
  }
  if (voiceChannelId) {
    lines.push(`Voice: <#${voiceChannelId}>`);
  }

  lines.push("", "Please be online 10 minutes before start.");
  const runUrl = dmRunUrl(input.run);
  if (runUrl) lines.push("", dmLink("Open Run", runUrl));
  return lines.join("\n");
}
