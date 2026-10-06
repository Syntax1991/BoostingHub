import {
  COMMUNITY_RAID_ID_WEEK_WEEKDAYS,
  type CommunityScheduleRunMode,
  type CommunityWeekday,
  type RaidDifficulty,
  type RunLootType,
} from "@/models/enums";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";

export const COMMUNITY_SCHEDULE_SHARE_FOOTER =
  "Please check which recurring Runs we have at the moment. 🙂";

export type CommunityScheduleShareSlotInput = {
  id: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  runMode: CommunityScheduleRunMode;
  runDescription: string;
  raidLeadDiscordId: string | null;
  raidLeadName: string;
};

export type FormatCommunityScheduleShareInput = {
  managementRoleId: string | null;
  slots: ReadonlyArray<CommunityScheduleShareSlotInput>;
};

export type FormatCommunityScheduleShareResult = {
  text: string;
  warnings: string[];
};

const WEEKDAY_SHARE_LABEL: Record<CommunityWeekday, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

const RUN_MODE_SHARE_LABEL: Record<CommunityScheduleRunMode, string> = {
  INHOUSE: "inhouse",
  TEAM_RUN: "Teamrun",
};

/** Canonical Management Discord run description: `7/9 HC VIP`. */
export function formatScheduleShareRunDescription(input: {
  plannedBossCount: number;
  totalBossCount: number;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): string {
  return `${input.plannedBossCount}/${input.totalBossCount} ${DIFFICULTY_ABBREVIATIONS[input.difficulty]} ${RUN_LOOT_TYPE_LABELS[input.lootType]}`;
}

function formatRaidLeadMention(slot: CommunityScheduleShareSlotInput): string {
  const discordId = slot.raidLeadDiscordId?.trim() ?? "";
  if (discordId.length > 0) {
    return `<@${discordId}>`;
  }
  return slot.raidLeadName;
}

function formatSlotBody(slot: CommunityScheduleShareSlotInput): string {
  return `${slot.localStartTime} ${slot.runDescription} ${formatRaidLeadMention(slot)} ${RUN_MODE_SHARE_LABEL[slot.runMode]}`;
}

/**
 * Pure Management Discord Share formatter. No DB / Discord / React side effects.
 */
export function formatCommunityScheduleShare(
  input: FormatCommunityScheduleShareInput,
): FormatCommunityScheduleShareResult {
  const warnings: string[] = [];
  const roleId = input.managementRoleId?.trim() ?? "";
  const header = roleId.length > 0 ? `<@&${roleId}>` : null;
  if (!header) {
    warnings.push("Management Discord role is not configured; the role mention was omitted.");
  }

  const missingDiscord = new Set<string>();
  for (const slot of input.slots) {
    const discordId = slot.raidLeadDiscordId?.trim() ?? "";
    if (!discordId) {
      missingDiscord.add(slot.raidLeadName);
    }
  }
  if (missingDiscord.size === 1) {
    warnings.push("1 Raid Lead has no linked Discord account and will be exported by name.");
  } else if (missingDiscord.size > 1) {
    warnings.push(
      `${missingDiscord.size} Raid Leads have no linked Discord account and will be exported by name.`,
    );
  }

  const byWeekday = new Map<CommunityWeekday, CommunityScheduleShareSlotInput[]>();
  for (const weekday of COMMUNITY_RAID_ID_WEEK_WEEKDAYS) {
    byWeekday.set(weekday, []);
  }
  for (const slot of input.slots) {
    const bucket = byWeekday.get(slot.weekday);
    if (!bucket) continue;
    bucket.push(slot);
  }

  const dayLines: string[] = [];
  for (const weekday of COMMUNITY_RAID_ID_WEEK_WEEKDAYS) {
    const daySlots = byWeekday.get(weekday) ?? [];
    if (daySlots.length === 0) continue;
    daySlots.sort((a, b) => {
      const byTime = a.localStartTime.localeCompare(b.localStartTime);
      if (byTime !== 0) return byTime;
      return a.id.localeCompare(b.id);
    });
    const bodies = daySlots.map(formatSlotBody).join(" & ");
    dayLines.push(`${WEEKDAY_SHARE_LABEL[weekday]}: ${bodies}`);
  }

  const parts: string[] = [];
  if (header) {
    parts.push(header);
    parts.push("");
  }
  if (dayLines.length > 0) {
    parts.push(...dayLines);
    parts.push("");
  }
  parts.push(COMMUNITY_SCHEDULE_SHARE_FOOTER);

  return { text: parts.join("\n"), warnings };
}
