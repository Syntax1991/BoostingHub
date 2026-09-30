/**
 * Persistent Discord Schedule posts for CURRENT / NEXT raid-ID weeks.
 * Pure rendering + signature helpers — no Discord API, no DB.
 */
import { createHash } from "node:crypto";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType, RunStatus } from "@/models/enums";
import { classifyRunWeek, type WowRunWeekBucket } from "@/lib/wow-run-week";

export const SCHEDULE_MESSAGE_FORMAT_VERSION = "v1" as const;

export type DiscordScheduleBucket = "CURRENT" | "NEXT";

export const DISCORD_SCHEDULE_BUCKETS = ["CURRENT", "NEXT"] as const satisfies readonly DiscordScheduleBucket[];

/** Active operational statuses eligible for the Schedule (not DRAFT/COMPLETED/CANCELLED). */
export const SCHEDULE_ELIGIBLE_STATUSES = ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const;

export type ScheduleEligibleStatus = (typeof SCHEDULE_ELIGIBLE_STATUSES)[number];

export const SCHEDULE_STATUS_EMOJI: Record<ScheduleEligibleStatus, string> = {
  OPEN: "🟢",
  ROSTERING: "🟡",
  PUBLISHED: "🔵",
  IN_PROGRESS: "🔴",
};

export const SCHEDULE_STATUS_LABEL: Record<ScheduleEligibleStatus, string> = {
  OPEN: "Open",
  ROSTERING: "Rostering",
  PUBLISHED: "Published",
  IN_PROGRESS: "In Progress",
};

export const SCHEDULE_EMBED_COLOR = 0xd4af37;

export const SCHEDULE_EMPTY_DESCRIPTION = "No active Runs scheduled.";

export type ScheduleRunRenderInput = {
  runId: string;
  scheduledStartAt: string;
  status: RunStatus;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Human coverage token, e.g. `8/8` or Bundle `9/9`. */
  titleCoverage: string;
  /** Display name shown on the Schedule line (nickname preferred). */
  raidLeadDisplay: string;
  runChannelId: string | null;
};

export function isScheduleEligibleStatus(status: RunStatus): status is ScheduleEligibleStatus {
  return (SCHEDULE_ELIGIBLE_STATUSES as readonly RunStatus[]).includes(status);
}

export function scheduleBucketForRun(input: {
  scheduledStartAt: string;
  status: RunStatus;
  now?: Date;
}): DiscordScheduleBucket | null {
  if (!isScheduleEligibleStatus(input.status)) return null;
  const { bucket } = classifyRunWeek({ scheduledStartAt: input.scheduledStartAt, now: input.now });
  if (bucket === "CURRENT" || bucket === "NEXT") return bucket;
  return null;
}

export function sortScheduleRuns<T extends { scheduledStartAt: string; runId: string }>(runs: readonly T[]): T[] {
  return [...runs].sort((a, b) => {
    const byTime = a.scheduledStartAt.localeCompare(b.scheduledStartAt);
    if (byTime !== 0) return byTime;
    return a.runId.localeCompare(b.runId);
  });
}

export function filterAndSortScheduleRuns(
  runs: readonly ScheduleRunRenderInput[],
  bucket: DiscordScheduleBucket,
  now: Date = new Date(),
): ScheduleRunRenderInput[] {
  const filtered = runs.filter((run) => scheduleBucketForRun({ ...run, now }) === bucket);
  return sortScheduleRuns(filtered);
}

/** Unix seconds for Discord `<t:UNIX:t>` timestamps. */
export function scheduleUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * One Schedule line:
 * `🟢 Open · <t:UNIX:t> · Heroic VIP 8/8 · <#chan> · Lead`
 * Channel mention omitted when no run channel exists yet.
 */
export function formatScheduleRunLine(run: ScheduleRunRenderInput): string {
  if (!isScheduleEligibleStatus(run.status)) {
    throw new Error(`Schedule line refused for status ${run.status}`);
  }
  const emoji = SCHEDULE_STATUS_EMOJI[run.status];
  const statusLabel = SCHEDULE_STATUS_LABEL[run.status];
  const difficulty = DIFFICULTY_LABELS[run.difficulty];
  const loot = RUN_LOOT_TYPE_LABELS[run.lootType];
  const when = `<t:${scheduleUnixSeconds(run.scheduledStartAt)}:t>`;
  const core = `${emoji} ${statusLabel} · ${when} · ${difficulty} ${loot} ${run.titleCoverage}`;
  const channel = run.runChannelId ? ` · <#${run.runChannelId}>` : "";
  return `${core}${channel} · ${run.raidLeadDisplay}`;
}

export function scheduleTitle(bucket: DiscordScheduleBucket): string {
  return bucket === "CURRENT" ? "📅 Current Raid ID — Schedule" : "📅 Next Raid ID — Schedule";
}

export function buildScheduleDescription(runs: readonly ScheduleRunRenderInput[]): string {
  if (runs.length === 0) return SCHEDULE_EMPTY_DESCRIPTION;
  return sortScheduleRuns(runs).map(formatScheduleRunLine).join("\n");
}

export function buildScheduleEmbed(input: {
  bucket: DiscordScheduleBucket;
  runs: readonly ScheduleRunRenderInput[];
}): {
  title: string;
  description: string;
  color: number;
} {
  return {
    title: scheduleTitle(input.bucket),
    description: buildScheduleDescription(input.runs),
    color: SCHEDULE_EMBED_COLOR,
  };
}

/**
 * Deterministic signature of what Discord should show. Screenshot/content
 * changes and format-version bumps force an edit even when messageId is stable.
 */
export function buildScheduleSignature(input: {
  bucket: DiscordScheduleBucket;
  runs: readonly ScheduleRunRenderInput[];
}): string {
  const sorted = sortScheduleRuns(input.runs);
  const payload = {
    v: SCHEDULE_MESSAGE_FORMAT_VERSION,
    bucket: input.bucket,
    runs: sorted.map((run) => ({
      runId: run.runId,
      scheduledStartAt: run.scheduledStartAt,
      status: run.status,
      difficulty: run.difficulty,
      lootType: run.lootType,
      titleCoverage: run.titleCoverage,
      raidLeadDisplay: run.raidLeadDisplay,
      runChannelId: run.runChannelId,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

/** Week buckets that never appear on either Schedule. */
export function isExcludedWeekBucket(bucket: WowRunWeekBucket): boolean {
  return bucket === "PAST" || bucket === "FUTURE";
}
