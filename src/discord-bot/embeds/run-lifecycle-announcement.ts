import { EmbedBuilder } from "discord.js";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

/**
 * Shared Run-channel lifecycle embeds. No role/member pings — message only.
 * Uses Discord native timestamps so each viewer sees local time.
 */

export function buildRunRescheduledChannelEmbed(input: {
  productLabel: string;
  previousScheduledStartAt: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): EmbedBuilder {
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const meta = `${difficulty} · ${input.lootType}`;
  return new EmbedBuilder()
    .setColor(0xf0b429)
    .setTitle("📅 Run Rescheduled")
    .setDescription(
      [
        "The schedule for this run has changed.",
        "",
        `**${input.productLabel}**`,
        meta,
        "",
        `**Old:** ${discordTimestamp(input.previousScheduledStartAt, "F")}`,
        `**New:** ${discordTimestamp(input.scheduledStartAt, "F")}`,
        "",
        "Please check the updated start time.",
      ].join("\n"),
    );
}

export function buildRunCancelledChannelEmbed(input: {
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): EmbedBuilder {
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const when = discordTimestamp(input.scheduledStartAt, "F");
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("❌ Run Cancelled")
    .setDescription(
      [
        "This run has been cancelled.",
        "",
        `**${input.productLabel}**`,
        `${when} · ${difficulty} · ${input.lootType}`,
        "",
        "No further action is required for this run.",
      ].join("\n"),
    );
}
