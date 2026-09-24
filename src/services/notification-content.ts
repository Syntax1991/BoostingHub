import { DEFAULT_TIME_ZONE, formatDateTime } from "@/lib/datetime";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { isInQuietHours, nextQuietHoursEndUtc, type QuietHoursSnapshot } from "@/lib/quiet-hours";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { runDetailPath } from "@/lib/run-routes";
import { escapeDiscordInlineText } from "@/lib/run-start-message";
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

export function rosterRemovedWebNotification(input: {
  runId: string;
  runTitle: string;
  characterLabel: string | null;
}): { title: string; message: string; href: string } {
  const suffix = input.characterLabel ? ` (${input.characterLabel})` : "";
  return {
    title: "Removed from roster",
    message: `You are no longer in the roster for ${input.runTitle}${suffix}.`,
    href: runDetailPath(input.runId),
  };
}

/** To the Raid Lead when a picked player withdraws — the reason is always included. */
export function rosterWithdrawnWebNotification(input: {
  runId: string;
  runTitle: string;
  playerName: string;
  characterLabel: string | null;
  reason: string;
}): { title: string; message: string; href: string } {
  const who = input.characterLabel ? `${input.playerName} (${input.characterLabel})` : input.playerName;
  return {
    title: "Player withdrew",
    message: `${who} withdrew from the roster for ${input.runTitle}. Reason: ${input.reason}`,
    href: runDetailPath(input.runId, "roster"),
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

export function runCancelledWebNotification(input: {
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
  timeZone?: string;
}): { title: string; message: string; href: string } {
  const when = formatDateTime(input.scheduledStartAt, input.timeZone ?? DEFAULT_TIME_ZONE);
  // Prefer run title (already includes schedule) but include when for clarity when title lacks date context.
  return {
    title: "Run cancelled",
    message: `${input.runTitle} was cancelled (${when}).`,
    href: runDetailPath(input.runId),
  };
}

export function runRescheduledWebNotification(input: {
  runId: string;
  productLabel: string;
  previousScheduledStartAt: string;
  nextScheduledStartAt: string;
  timeZone?: string;
}): { title: string; message: string; href: string } {
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const from = formatDateTime(input.previousScheduledStartAt, tz);
  const to = formatDateTime(input.nextScheduledStartAt, tz);
  const params = new URLSearchParams({
    prev: input.previousScheduledStartAt,
    next: input.nextScheduledStartAt,
  });
  return {
    title: "Run rescheduled",
    message: `${input.productLabel} moved from ${from} to ${to}.`,
    href: `${runDetailPath(input.runId)}?${params.toString()}`,
  };
}

export function parseRescheduleHrefTimestamps(href: string): {
  previousScheduledStartAt: string | null;
  nextScheduledStartAt: string | null;
} {
  try {
    const url = new URL(href, "https://boostinghub.local");
    return {
      previousScheduledStartAt: url.searchParams.get("prev"),
      nextScheduledStartAt: url.searchParams.get("next"),
    };
  } catch {
    return { previousScheduledStartAt: null, nextScheduledStartAt: null };
  }
}

/**
 * Effective Discord DM intent at event creation.
 * Master toggle AND event toggle AND usable Discord identity — snapshotted.
 * Quiet Hours may set discordDeliverAfter but never change PENDING→SKIPPED.
 */
export type DiscordDmDeliveryDecision = {
  status: DiscordDeliveryStatus;
  discordUserId: string | null;
  discordDeliverAfter: string | null;
};

export function resolveDiscordDelivery(input: {
  discordDmEnabled: boolean;
  eventDmEnabled: boolean;
  discordUserId: string | null | undefined;
  quietHours?: QuietHoursSnapshot;
  timeZone?: string;
  now?: Date;
}): DiscordDmDeliveryDecision {
  const discordUserId = input.discordUserId?.trim() || null;
  const isDiscordDmEligible =
    input.discordDmEnabled && input.eventDmEnabled && Boolean(discordUserId);
  if (!isDiscordDmEligible) {
    return { status: "SKIPPED", discordUserId: null, discordDeliverAfter: null };
  }

  let discordDeliverAfter: string | null = null;
  const quietHours = input.quietHours;
  if (quietHours?.enabled && quietHours.start && quietHours.end) {
    const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
    const now = input.now ?? new Date();
    if (isInQuietHours({ now, timeZone, start: quietHours.start, end: quietHours.end })) {
      discordDeliverAfter = nextQuietHoursEndUtc({
        now,
        timeZone,
        start: quietHours.start,
        end: quietHours.end,
      });
    }
  }

  return { status: "PENDING", discordUserId, discordDeliverAfter };
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
  const when = discordTimestamp(input.scheduledStartAt, "F");
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
  lines.push("", "You are in the roster.");
  return lines.join("\n");
}

export function buildRosterRemovedDmMessage(input: {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): string {
  const when = discordTimestamp(input.scheduledStartAt, "F");
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  return [
    "↩️ **Roster Update**",
    "",
    input.productLabel,
    `${when} · ${difficulty} · ${input.lootType}`,
    "",
    "You are no longer in the roster for this run.",
  ].join("\n");
}

/**
 * Raid Lead DM when a picked player withdraws. Player-controlled text (name,
 * character, reason) is escaped so it cannot mention anyone or break markdown.
 */
export function buildRosterWithdrawnDmMessage(input: {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  playerName: string;
  characterLabel: string | null;
  reason: string;
  rosterUrl: string | null;
}): string {
  const when = discordTimestamp(input.scheduledStartAt, "F");
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const who = input.characterLabel
    ? `**${escapeDiscordInlineText(input.playerName)}** (${escapeDiscordInlineText(input.characterLabel)})`
    : `**${escapeDiscordInlineText(input.playerName)}**`;
  const lines = [
    "🚪 **Roster Withdrawal**",
    "",
    input.productLabel,
    `${when} · ${difficulty} · ${input.lootType}`,
    "",
    `${who} withdrew from the roster.`,
    `Reason: ${escapeDiscordInlineText(input.reason)}`,
  ];
  if (input.rosterUrl) {
    lines.push("", `Pick a replacement: ${input.rosterUrl}`);
  }
  return lines.join("\n");
}

export function buildRunCancelledDmMessage(input: {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): string {
  const when = discordTimestamp(input.scheduledStartAt, "F");
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  return [
    "❌ **Run Cancelled**",
    "",
    input.productLabel,
    `${when} · ${difficulty} · ${input.lootType}`,
    "",
    "This run has been cancelled.",
  ].join("\n");
}

export function buildRunRescheduledDmMessage(input: {
  productLabel: string;
  previousScheduledStartAt: string;
  nextScheduledStartAt: string;
}): string {
  return [
    "📅 **Run Rescheduled**",
    "",
    input.productLabel,
    "",
    `Old: ${discordTimestamp(input.previousScheduledStartAt, "F")}`,
    `New: ${discordTimestamp(input.nextScheduledStartAt, "F")}`,
    "",
    "Please check the updated run time.",
  ].join("\n");
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
