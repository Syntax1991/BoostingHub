import type { Client, GuildEmoji } from "discord.js";
import { CLASS_DISCORD_EMOJI_NAMES } from "@/lib/run-start-message";
import type { WowClass } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";

/**
 * Resolve Guild custom class emojis once per Final Setup sync.
 * Maps WowClass → Discord custom-emoji markup (<:name:id> / <a:name:id>).
 * Missing guild emojis are omitted so the formatter falls back to class labels.
 */
export async function resolveGuildClassIndicators(
  client: Client,
  guildId: string,
): Promise<Partial<Record<WowClass, string>>> {
  const guild = await client.guilds.fetch(guildId);
  await guild.emojis.fetch();

  const byName = new Map<string, GuildEmoji>();
  for (const emoji of guild.emojis.cache.values()) {
    if (emoji.name) {
      byName.set(emoji.name, emoji);
    }
  }

  const indicators: Partial<Record<WowClass, string>> = {};
  for (const wowClass of WOW_CLASSES) {
    const name = CLASS_DISCORD_EMOJI_NAMES[wowClass];
    const emoji = byName.get(name);
    if (emoji) {
      indicators[wowClass] = emoji.toString();
    }
  }
  return indicators;
}
