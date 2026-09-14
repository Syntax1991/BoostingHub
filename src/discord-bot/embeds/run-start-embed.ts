import { EmbedBuilder } from "discord.js";
import { formatFinalSetup, type FinalSetupInput } from "@/lib/run-start-message";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

function toFinalSetupInput(data: RunStartEmbedData): FinalSetupInput {
  return {
    raidName: data.raidName,
    difficulty: data.difficulty,
    lootType: data.lootType,
    targets: data.targets,
    groups: data.groups,
  };
}

/**
 * Compact operational Final Setup post for the dedicated Run channel.
 * Body comes from the shared Final Setup formatter (same as the web Start preview).
 */
export function buildRunStartEmbed(data: RunStartEmbedData): EmbedBuilder {
  const message = formatFinalSetup(toFinalSetupInput(data));
  return new EmbedBuilder()
    .setTitle(message.title)
    .setDescription(message.body)
    .setFooter({ text: message.footer })
    .setColor(0xf1c40f);
}

/** Plain-text projection used by unit tests (title + description). */
export function renderRunStartMessageText(data: RunStartEmbedData): string {
  const embed = buildRunStartEmbed(data);
  const title = embed.data.title ?? "";
  const description = embed.data.description ?? "";
  return `${title}\n\n${description}`;
}
