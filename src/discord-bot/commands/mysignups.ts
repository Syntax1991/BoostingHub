import type { ChatInputCommandInteraction } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";

type MySignupItem = {
  runId: string;
  runTitle: string;
  participationType: "BOOSTER" | "LOOTBUDDY";
  characterName: string | null;
  status: "PENDING" | "SELECTED" | "NOT_SELECTED" | "WITHDRAWN";
};

type MyRunsPayload = {
  pending: MySignupItem[];
  selected: MySignupItem[];
  notSelected: MySignupItem[];
};

type RunGroup = { runTitle: string; participationType: string; offers: string[]; selected: string | null };

/**
 * Groups the flat per-Character signup rows by Run + participation type —
 * the same "one Run, one card" presentation as the Web My Runs page — so a
 * User who offered three Characters sees one line, not three.
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
      group.offers.push(item.characterName ?? "Unknown character");
      if (item.status === "SELECTED") {
        group.selected = item.characterName ?? "Unknown character";
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
