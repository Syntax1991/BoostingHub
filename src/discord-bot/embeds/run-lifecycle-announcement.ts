import { EmbedBuilder } from "discord.js";
import { absoluteRunUrl } from "@/lib/app-url";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { DIFFICULTY_ABBREVIATIONS, DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { formatRunScopeChangeDetail, type RunScopeChange } from "@/lib/run-scope-change";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

/**
 * Shared Run-channel lifecycle embeds. No role/member pings — message only.
 * Uses Discord native timestamps so each viewer sees local time.
 */

function withCanonicalRunUrl(embed: EmbedBuilder, runId: string): EmbedBuilder {
  const runUrl = absoluteRunUrl(runId);
  if (runUrl) embed.setURL(runUrl);
  return embed;
}

/** Run identity for lifecycle posts: the compact content title, else the stored product label. */
function runLabel(input: { productLabel: string; contentTitle?: string }): string {
  return input.contentTitle?.trim() || input.productLabel;
}

/** Run identity first, then the change: old → new time, and the way back to the Run. */
export function buildRunRescheduledChannelEmbed(input: {
  runId: string;
  productLabel: string;
  contentTitle?: string;
  previousScheduledStartAt: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): EmbedBuilder {
  const runUrl = absoluteRunUrl(input.runId);
  return withCanonicalRunUrl(
    new EmbedBuilder()
      .setColor(0xf0b429)
      .setTitle(`📅 Rescheduled · ${runLabel(input)}`.slice(0, 256))
      .setDescription(
        [
          `${DIFFICULTY_ABBREVIATIONS[input.difficulty]} · ${RUN_LOOT_TYPE_LABELS[input.lootType]}`,
          "",
          `**Old:** ~~${discordTimestamp(input.previousScheduledStartAt, "F")}~~`,
          `**New:** ${discordTimestamp(input.scheduledStartAt, "F")} (${discordTimestamp(input.scheduledStartAt, "R")})`,
          ...(runUrl ? ["", `🔗 [Open Run](${runUrl})`] : []),
        ].join("\n"),
      ),
    input.runId,
  );
}

/** Only the changed contents — never the unchanged Run state. */
export function buildRunScopeChangedChannelEmbed(input: {
  runId: string;
  productLabel: string;
  contentTitle?: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  changes: readonly RunScopeChange[];
}): EmbedBuilder {
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const when = discordTimestamp(input.scheduledStartAt, "F");
  return withCanonicalRunUrl(
    new EmbedBuilder()
      .setColor(0xf0b429)
      .setTitle("⚠️ Run Updated")
      .setDescription(
        [
          "The planned raid scope has changed.",
          "",
          `${when} · ${difficulty} · ${input.lootType}`,
          "",
          ...input.changes.flatMap((change) => [`**${change.raidName}**`, formatRunScopeChangeDetail(change), ""]),
          "Please check the updated Run details.",
        ].join("\n"),
      ),
    input.runId,
  );
}

export function buildRunCancelledChannelEmbed(input: {
  runId: string;
  productLabel: string;
  contentTitle?: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): EmbedBuilder {
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const when = discordTimestamp(input.scheduledStartAt, "F");
  return withCanonicalRunUrl(
    new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Run Cancelled")
      .setDescription(
        [
          "This run has been cancelled.",
          "",
          `**${runLabel(input)}**`,
          `${when} · ${difficulty} · ${input.lootType}`,
          "",
          "No further action is required for this run.",
        ].join("\n"),
      ),
    input.runId,
  );
}

export function buildRunReactivatedChannelEmbed(input: {
  runId: string;
  productLabel: string;
  contentTitle?: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): EmbedBuilder {
  const difficulty = DIFFICULTY_LABELS[input.difficulty].toUpperCase();
  const when = discordTimestamp(input.scheduledStartAt, "F");
  return withCanonicalRunUrl(
    new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Run Reactivated")
      .setDescription(
        [
          "The previously cancelled Run is active again.",
          "",
          `**${runLabel(input)}**`,
          `${when} · ${difficulty} · ${input.lootType}`,
          "",
          "Please check the Run channel for the current signup and roster state.",
        ].join("\n"),
      ),
    input.runId,
  );
}
