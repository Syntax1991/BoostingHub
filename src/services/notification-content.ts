import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { runDetailPath } from "@/lib/run-routes";
import type { CharacterRole, ParticipationType, RaidDifficulty, RunLootType, WowClass } from "@/models/enums";
import type { DiscordDeliveryStatus } from "@/models/enums";

export type NotificationAssignmentInput = {
  participationType: ParticipationType;
  publishedRole: CharacterRole | null;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
};

export function formatNotificationAssignment(input: NotificationAssignmentInput): string {
  if (input.participationType === "LOOTBUDDY") {
    const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;
    if (classLabel) return `Lootbuddy · ${classLabel}`;
    return "Lootbuddy";
  }
  const role = input.publishedRole ? CHARACTER_ROLE_LABELS[input.publishedRole] : "Booster";
  const name = input.characterName?.trim() || "Unknown";
  const realm = input.characterRealm?.trim();
  const identity = realm ? `${name}-${realm}` : name;
  const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;
  if (classLabel) return `${role} · ${identity} (${classLabel})`;
  return `${role} · ${identity}`;
}

export function buildRosterSelectedWebCopy(input: {
  runTitle: string;
  assignment: NotificationAssignmentInput;
}): { title: string; message: string; href: string; runId: string } {
  return {
    title: "Roster selected",
    message: `You were selected for ${input.runTitle} as ${formatNotificationAssignment(input.assignment)}.`,
    href: "",
    runId: "",
  };
}

export function rosterSelectedWebNotification(input: {
  runId: string;
  runTitle: string;
  assignment: NotificationAssignmentInput;
}): { title: string; message: string; href: string } {
  return {
    title: "Roster selected",
    message: `You were selected for ${input.runTitle} as ${formatNotificationAssignment(input.assignment)}.`,
    href: runDetailPath(input.runId),
  };
}

export function raidInviteWebNotification(input: {
  runId: string;
  productLabel: string;
  assignment: NotificationAssignmentInput;
}): { title: string; message: string; href: string } {
  return {
    title: "Raid Invite",
    message: `Your run is starting. ${formatNotificationAssignment(input.assignment)} · ${input.productLabel}.`,
    href: runDetailPath(input.runId),
  };
}

export function resolveDiscordDelivery(input: {
  preferenceEnabled: boolean;
  discordUserId: string | null | undefined;
}): { status: DiscordDeliveryStatus; discordUserId: string | null } {
  const discordUserId = input.discordUserId?.trim() || null;
  if (!input.preferenceEnabled || !discordUserId) {
    return { status: "SKIPPED", discordUserId: null };
  }
  return { status: "PENDING", discordUserId };
}

/**
 * Roster Pick Discord DM body.
 * Channel line uses a real `<#id>` mention only when runChannelId is set.
 */
export function buildRosterSelectedDmMessage(input: {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  assignment: NotificationAssignmentInput;
  runChannelId: string | null;
}): string {
  const when = formatDateTime(input.scheduledStartAt);
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const loot = input.lootType;
  const assignment = formatRosterDmAssignment(input.assignment);
  const lines = [
    "✅ **Roster Selected**",
    "",
    input.productLabel,
    `${when} · ${difficulty} · ${loot}`,
    "",
    `Assignment: ${assignment}`,
  ];
  const channelId = input.runChannelId?.trim() || null;
  if (channelId) {
    lines.push(`Channel: <#${channelId}>`);
  }
  lines.push("", "You are in the published roster.");
  return lines.join("\n");
}

function formatRosterDmAssignment(input: NotificationAssignmentInput): string {
  if (input.participationType === "LOOTBUDDY") {
    const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;
    if (classLabel) return `Lootbuddy · (${classLabel})`;
    return "Lootbuddy";
  }
  const role = input.publishedRole ? CHARACTER_ROLE_LABELS[input.publishedRole] : "Booster";
  const name = input.characterName?.trim() || "Unknown";
  const classLabel = input.wowClass ? CLASS_LABELS[input.wowClass] : null;
  if (classLabel) return `${role} · ${name} (${classLabel})`;
  return `${role} · ${name}`;
}
