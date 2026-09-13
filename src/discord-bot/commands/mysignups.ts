import type { ChatInputCommandInteraction } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { CLASS_LABELS } from "@/lib/labels";
import type { WowClass } from "@/models/enums";

type MySignupItem = {
  runId: string;
  runTitle: string;
  participationType: "BOOSTER" | "LOOTBUDDY";
  characterName: string | null;
  lootbuddyClass?: WowClass | null;
  status: "PENDING" | "SELECTED" | "NOT_SELECTED" | "WITHDRAWN";
};

type MyRunsPayload = {
  pending: MySignupItem[];
  selected: MySignupItem[];
  notSelected: MySignupItem[];
};

type RunGroup = { runTitle: string; participationType: string; offers: string[]; selected: string | null };

function offerLabel(item: MySignupItem): string {
  if (item.characterName) return item.characterName;
  if (item.lootbuddyClass) return CLASS_LABELS[item.lootbuddyClass];
  return item.participationType === "LOOTBUDDY" ? "Lootbuddy" : "Unknown character";
}

/**
 * Groups the flat per-participation signup rows by Run + participation type —
 * the same "one Run, one card" presentation as the Web My Runs page — so a
 * User who offered three Characters / Lootbuddies sees one line, not three.
 */
export function formatMySignups(data: MyRunsPayload): string[] {
  const byRun = new Map<string, RunGroup>();
  for (const bucket of [data.selected, data.pending, data.notSelected]) {
    for (const item of bucket) {
      const key = `${item.runId}:${item.participationType}`;
      const group = byRun.get(key) ?? {
        runTitle: item.runTitle,
        participationType: item.participationType,
        offers: [],
        selected: null,
      };
      group.offers.push(offerLabel(item));
      if (item.status === "SELECTED") {
        group.selected = offerLabel(item);
      }
      byRun.set(key, group);
    }
  }

  return [...byRun.values()].map(
    (group) =>
      `**${group.runTitle}** (${group.participationType}) — Offered: ${group.offers.join(", ")} · Selected: ${group.selected ?? "Pending"}`,
  );
}

export async function handleMySignupsCommand(interaction: ChatInputCommandInteraction, api: BotApiClient): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const data = (await api.getMySignups(interaction.user.id)) as MyRunsPayload;
    const lines = formatMySignups(data);
    await interaction.editReply({ content: lines.length > 0 ? lines.join("\n") : "You have no active signups." });
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}
