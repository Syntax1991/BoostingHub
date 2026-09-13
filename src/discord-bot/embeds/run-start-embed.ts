import { EmbedBuilder } from "discord.js";
import { characterLabel } from "@/discord-bot/format";
import { classIndicator } from "@/discord-bot/class-display";
import type { RunStartEmbedData } from "@/services/discord-sync.service";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";

function mentionDisplay(discordUserId: string | null, userName: string): string {
  return discordUserId ? `<@${discordUserId}>` : `@${userName}`;
}

function boosterLine(member: RunStartEmbedData["groups"]["tanks"][number]): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const character = characterLabel(member.characterName, member.characterRealm);
  const indicator = classIndicator(member.wowClass, member.classLabel);
  return indicator ? `${mention} — ${character} — ${indicator}` : `${mention} — ${character}`;
}

function lootbuddyLine(member: RunStartEmbedData["groups"]["lootbuddies"][number]): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const indicator = classIndicator(member.wowClass, member.classLabel);
  return indicator ? `${mention} — ${indicator}` : mention;
}

function roleSection(emoji: string, label: string, selected: number, target: number, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "—";
  return `${emoji} **${label}** ${emoji} ${selected}/${target}\n${body}`;
}

function lootbuddySection(selected: number, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "—";
  return `📦 **Lootbuddies** 📦 ${selected}\n${body}`;
}

/**
 * Compact operational Final Setup post for the dedicated Run channel.
 * Groups Tanks / Healers / DPS / Lootbuddies (no melee/ranged DPS split) and
 * appends the two immutable Gold Collector whisper commands.
 */
export function buildRunStartEmbed(data: RunStartEmbedData): EmbedBuilder {
  const body = [
    roleSection("🛡", "Tanks", data.groups.tanks.length, data.targets.tanks, data.groups.tanks.map(boosterLine)),
    roleSection("✚", "Healers", data.groups.healers.length, data.targets.healers, data.groups.healers.map(boosterLine)),
    roleSection("⚔", "DPS", data.groups.dps.length, data.targets.dps, data.groups.dps.map(boosterLine)),
    lootbuddySection(data.groups.lootbuddies.length, data.groups.lootbuddies.map(lootbuddyLine)),
    `/w ${data.goldCollectors[0].name}-${data.goldCollectors[0].realm} inv`,
    `/w ${data.goldCollectors[1].name}-${data.goldCollectors[1].realm} inv`,
  ].join("\n\n");

  return new EmbedBuilder()
    .setTitle("Final Setup")
    .setDescription(body)
    .setFooter({
      text: `${data.raidName} · ${DIFFICULTY_LABELS[data.difficulty]} · ${RUN_LOOT_TYPE_LABELS[data.lootType]}`,
    })
    .setColor(0xf1c40f);
}

/** Plain-text projection used by unit tests (title + description). */
export function renderRunStartMessageText(data: RunStartEmbedData): string {
  const embed = buildRunStartEmbed(data);
  const title = embed.data.title ?? "";
  const description = embed.data.description ?? "";
  return `${title}\n\n${description}`;
}
