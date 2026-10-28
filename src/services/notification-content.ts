import { DEFAULT_TIME_ZONE, formatDateTime } from "@/lib/datetime";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { dmRunHeader, dmRunUrl, type DmRunContext } from "@/lib/discord-run-dm";
import { isInQuietHours, nextQuietHoursEndUtc, type QuietHoursSnapshot } from "@/lib/quiet-hours";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS } from "@/lib/labels";
import { runDetailPath } from "@/lib/run-routes";
import { formatRunScopeChangeLines, type RunScopeChange } from "@/lib/run-scope-change";
import { escapeDiscordInlineText } from "@/lib/run-start-message";
import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";
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

/** A booster's character was swapped for another of their signups — still in the roster. */
export function rosterSwappedWebNotification(input: {
  runId: string;
  runTitle: string;
  assignment: NotificationAssignmentInput;
}): { title: string; message: string; href: string } {
  return {
    title: "Roster updated",
    message: `Your roster slot for ${input.runTitle} changed to ${formatNotificationAssignment(input.assignment)}.`,
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

/**
 * ROSTER_CHARACTER_SAVED — a picked Character newly killed planned bosses
 * elsewhere this raid ID. Player: get it sorted with the Raid Lead. Raid Lead: check the roster.
 */
export function rosterCharacterSavedWebNotification(input: {
  audience: "player" | "lead" | "start";
  runId: string;
  runTitle: string;
  characterLabel: string;
  playerName: string;
  bossNames: readonly string[];
}): { title: string; message: string; href: string } {
  const bosses = input.bossNames.join(", ");
  if (input.audience === "start") {
    return {
      title: "Reminder: you are saved",
      message: `${input.characterLabel} is saved on ${bosses} for ${input.runTitle} — no loot from those bosses for you.`,
      href: runDetailPath(input.runId),
    };
  }
  if (input.audience === "player") {
    return {
      title: "Picked Character is saved",
      message:
        `${input.characterLabel} is picked for ${input.runTitle} but already killed ${bosses} this raid ID — ` +
        "no loot there. Please contact the Raid Lead.",
      href: runDetailPath(input.runId),
    };
  }
  return {
    title: "Picked Character got saved",
    message:
      `${input.characterLabel} (${input.playerName}) is picked for ${input.runTitle} and is now saved on ${bosses}. ` +
      "Check the roster.",
    href: runDetailPath(input.runId, "roster"),
  };
}

/** One line per affected pick, e.g. `Synblast-Antonidas — Boss B, Boss C`. */
export type SavedSelectedEntry = { characterLabel: string; bossNames: readonly string[] };

function savedSelectedLines(entries: readonly SavedSelectedEntry[]): string[] {
  return entries.map((entry) => `${entry.characterLabel} — ${entry.bossNames.join(", ")}`);
}

function savedSelectedHeadline(count: number): string {
  return count === 1 ? "1 selected Character is saved:" : `${count} selected Characters are saved:`;
}

/**
 * ROSTER_CHARACTER_SAVED summary to the Raid Lead after the Start Run re-check:
 * every SELECTED Booster Character saved on a planned boss, in one notification.
 */
export function rosterSelectedSavedSummaryWebNotification(input: {
  runId: string;
  entries: readonly SavedSelectedEntry[];
}): { title: string; message: string; href: string } {
  return {
    title: "Selected Characters are saved",
    message: [savedSelectedHeadline(input.entries.length), ...savedSelectedLines(input.entries), "Check the roster."].join("\n"),
    href: runDetailPath(input.runId, "roster"),
  };
}

/**
 * DM for the Start Run summary: the notification's own `message` (already the
 * affected-set snapshot) under a Discord heading. Lines are only escaped for
 * display — never interpreted as Characters / bosses.
 */
export function buildRosterSelectedSavedSummaryDmMessage(input: {
  run: DmRunContext;
  message: string;
  rosterUrl: string | null;
}): string {
  const lines = [
    ...dmRunHeader("⚠️ **Selected Characters are saved**", input.run),
    ...input.message.split(/\r?\n/).map((line) => escapeDiscordInlineText(line)),
  ];
  if (input.rosterUrl) lines.push("", input.rosterUrl);
  return lines.join("\n");
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

export function runScopeChangedWebNotification(input: {
  runId: string;
  productLabel: string;
  scheduledStartAt: string;
  changes: readonly RunScopeChange[];
  timeZone?: string;
}): { title: string; message: string; href: string } {
  const when = formatDateTime(input.scheduledStartAt, input.timeZone ?? DEFAULT_TIME_ZONE);
  return {
    title: "Run updated",
    message: `The planned raid scope of ${input.productLabel} (${when}) changed: ${formatRunScopeChangeLines(
      input.changes,
    ).join("; ")}.`,
    href: runDetailPath(input.runId),
  };
}

export function runReactivatedWebNotification(input: {
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
  timeZone?: string;
}): { title: string; message: string; href: string } {
  const when = formatDateTime(input.scheduledStartAt, input.timeZone ?? DEFAULT_TIME_ZONE);
  return {
    title: "Run reactivated",
    message: `${input.runTitle} is active again (${when}).`,
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
  run: DmRunContext;
  assignment: NotificationAssignmentInput;
  runChannelId: string | null;
  /** Character swap for a player already in the roster: "Roster Update" instead of "Roster Selected". */
  update?: boolean;
}): string {
  const lines = [
    ...dmRunHeader(input.update ? "🔁 **Roster Update**" : "✅ **Roster Selected**", input.run),
    `Assignment: ${formatRosterDmAssignment(input.assignment)}`,
  ];
  const channelId = input.runChannelId?.trim() || null;
  if (channelId) {
    lines.push(`Channel: <#${channelId}>`);
  }
  lines.push("", input.update ? "Your character changed — you are still in the roster." : "You are in the roster.");
  return withRunLink(lines, dmRunUrl(input.run));
}

export function buildRosterRemovedDmMessage(input: { run: DmRunContext }): string {
  return withRunLink(
    [...dmRunHeader("↩️ **Roster Update**", input.run), "You are no longer in the roster for this run."],
    dmRunUrl(input.run),
  );
}

/**
 * Raid Lead DM when a picked player withdraws. Player-controlled text (name,
 * character, reason) is escaped so it cannot mention anyone or break markdown.
 */
export function buildRosterWithdrawnDmMessage(input: {
  run: DmRunContext;
  playerName: string;
  characterLabel: string | null;
  reason: string;
  rosterUrl: string | null;
}): string {
  const who = input.characterLabel
    ? `**${escapeDiscordInlineText(input.playerName)}** (${escapeDiscordInlineText(input.characterLabel)})`
    : `**${escapeDiscordInlineText(input.playerName)}**`;
  const lines = [
    ...dmRunHeader("🚪 **Roster Withdrawal**", input.run),
    `${who} withdrew from the roster.`,
    `Reason: ${escapeDiscordInlineText(input.reason)}`,
  ];
  if (input.rosterUrl) {
    lines.push("", `Pick a replacement: ${input.rosterUrl}`);
  }
  return lines.join("\n");
}

export function buildRosterCharacterSavedDmMessage(input: {
  run: DmRunContext;
  audience: "player" | "lead" | "start";
  characterLabel: string;
  playerName: string;
  bossNames: readonly string[];
  url: string | null;
}): string {
  const character = `**${escapeDiscordInlineText(input.characterLabel)}**`;
  const bosses = input.bossNames.map((name) => escapeDiscordInlineText(name)).join(", ");
  const heading = {
    player: "⚠️ **Your picked Character is saved**",
    lead: "⚠️ **Picked Character got saved**",
    start: "⏰ **Reminder: you are saved**",
  }[input.audience];
  const lines = dmRunHeader(heading, input.run);
  if (input.audience === "start") {
    lines.push(`${character} is saved on **${bosses}** — no loot from those bosses for you this Run.`);
  } else if (input.audience === "player") {
    lines.push(
      `${character} is picked for this Run but already killed **${bosses}** this raid ID — no loot there.`,
      "Please contact the Raid Lead.",
    );
  } else {
    lines.push(
      `${character} (${escapeDiscordInlineText(input.playerName)}) is picked and is now saved on **${bosses}**.`,
    );
  }
  if (input.url) {
    lines.push("", input.audience === "lead" ? `Check the roster: ${input.url}` : input.url);
  }
  return lines.join("\n");
}

/**
 * CHARACTER_BATTLENET_REPAIR copy — sent once per broken Blizzard identity of a
 * linked Character (see character-repair-notification.service). Tells the
 * owner to reconnect Battle.net, which repairs the link and keeps history;
 * deleting and re-importing would drop it.
 */
export function characterBattleNetRepairWebNotification(input: {
  characterId: string;
  characterLabel: string;
}): { title: string; message: string; href: string } {
  return {
    title: "Reconnect Battle.net to repair a character",
    message:
      `Blizzard no longer shows ${input.characterLabel} under its stored name, realm or character ID — it was probably ` +
      "renamed, transferred or re-created. Reconnect Battle.net on the Characters page once: the link repairs itself " +
      "and the character keeps its signups and history. No need to delete it.",
    href: `/characters/${input.characterId}`,
  };
}

export function buildCharacterBattleNetRepairDmMessage(input: {
  characterLabel: string;
  charactersUrl: string | null;
}): string {
  const lines = [
    "🔗 **Battle.net link needs a refresh**",
    "",
    `Blizzard no longer shows **${escapeDiscordInlineText(input.characterLabel)}** under its stored name, realm or ` +
      "character ID — it was probably renamed, transferred or re-created.",
    "",
    "Reconnect Battle.net on the Characters page once: the link repairs itself and the character keeps its signups " +
      "and history. No need to delete it. If the character no longer exists in-game, deactivate it instead.",
  ];
  if (input.charactersUrl) {
    lines.push("", input.charactersUrl);
  }
  return lines.join("\n");
}

export function buildRunCancelledDmMessage(input: { run: DmRunContext }): string {
  return withRunLink([...dmRunHeader("❌ **Run Cancelled**", input.run), "This run has been cancelled."], dmRunUrl(input.run));
}

export function buildRunScopeChangedDmMessage(input: {
  run: DmRunContext;
  changes: readonly RunScopeChange[];
}): string {
  const runUrl = dmRunUrl(input.run);
  return [
    ...dmRunHeader("⚠️ **Run Updated**", input.run),
    "The planned raid scope changed:",
    ...formatRunScopeChangeLines(input.changes),
    "",
    runUrl ? `Please review the updated Run: ${runUrl}` : "Please review the updated Run.",
  ].join("\n");
}

export function buildRunReactivatedDmMessage(input: { run: DmRunContext }): string {
  return withRunLink(
    [...dmRunHeader("✅ **Run Reactivated**", input.run), "The previously cancelled Run is active again."],
    dmRunUrl(input.run),
  );
}

/**
 * `run.scheduledStartAt` is the NEW time. Old / New replace the usual meta
 * line, so the title is followed by the two times directly.
 */
export function buildRunRescheduledDmMessage(input: {
  run: DmRunContext;
  previousScheduledStartAt: string;
}): string {
  return withRunLink(
    [
      "📅 **Run Rescheduled**",
      "",
      input.run.contentTitle,
      "",
      `Old: ${discordTimestamp(input.previousScheduledStartAt, "F")}`,
      `New: ${discordTimestamp(input.run.scheduledStartAt, "F")}`,
      "",
      "Please check the updated run time.",
    ],
    dmRunUrl(input.run),
  );
}

/** Closing Run link (blank line, then the URL) when the app URL is configured. */
function withRunLink(lines: string[], runUrl: string | null): string {
  if (runUrl) lines.push("", runUrl);
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
