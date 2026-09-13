import { EmbedBuilder } from "discord.js";
import type { RunStartEmbedData } from "@/services/discord-sync.service";
import { discordTimestamp } from "@/discord-bot/format";

const DIFFICULTY_LABEL: Record<RunStartEmbedData["difficulty"], string> = {
  NORMAL: "Normal",
  HEROIC: "Heroic",
  MYTHIC: "Mythic",
};

const LOOT_LABEL: Record<RunStartEmbedData["lootType"], string> = {
  UNSAVED: "Unsaved",
  SAVED: "Saved",
  VIP: "VIP",
};

function mentionDisplay(discordUserId: string | null, userName: string): string {
  return discordUserId ? `<@${discordUserId}>` : `@${userName}`;
}

function boosterLine(member: RunStartEmbedData["groups"]["tanks"][number]): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const classLabel = member.classLabel ?? "Unknown";
  return `${mention} - ${member.characterName} - ${classLabel} - ${member.saveLabel}`;
}

function lootbuddyLine(member: RunStartEmbedData["groups"]["lootbuddies"][number]): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  return member.classLabel ? `${mention} - ${member.classLabel}` : mention;
}

function section(title: string, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "—";
  return `**${title} (${lines.length})**\n${body}`;
}

/**
 * Operational Run Start roster for the dedicated Run channel.
 * Groups Tanks / Healers / DPS / Lootbuddies (no melee/ranged DPS split) and
 * appends the two immutable Gold Collector whisper commands.
 */
export function buildRunStartEmbed(data: RunStartEmbedData): EmbedBuilder {
  const heading = `${data.raidName} - ${discordTimestamp(data.scheduledStartAt)} - ${DIFFICULTY_LABEL[data.difficulty]} - ${LOOT_LABEL[data.lootType]}`;
  const body = [
    section("TANKS", data.groups.tanks.map(boosterLine)),
    section("HEALERS", data.groups.healers.map(boosterLine)),
    section("DPS", data.groups.dps.map(boosterLine)),
    section("LOOTBUDDIES", data.groups.lootbuddies.map(lootbuddyLine)),
    `/w ${data.goldCollectors[0].name}-${data.goldCollectors[0].realm} inv`,
    `/w ${data.goldCollectors[1].name}-${data.goldCollectors[1].realm} inv`,
  ].join("\n\n");

  return new EmbedBuilder()
    .setTitle(data.runTitle)
    .setDescription(`${heading}\n\n${body}`)
    .setColor(0xf1c40f);
}

/** Plain-text projection used by unit tests (same content as the embed description). */
export function renderRunStartMessageText(data: RunStartEmbedData): string {
  return buildRunStartEmbed(data).data.description ?? "";
}
