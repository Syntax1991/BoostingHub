import type { Client, GuildEmoji } from "discord.js";
import { CLASS_DISCORD_EMOJI_NAMES } from "@/lib/run-start-message";
import type { WowClass } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";

/** Logical role keys used in signup/roster embeds (API + fingerprints). */
export const ROLE_DISCORD_EMOJI_KEYS = ["tank", "healer", "dps", "lootbuddy", "raidlead"] as const;
export type RoleDiscordEmojiKey = (typeof ROLE_DISCORD_EMOJI_KEYS)[number];

/** Discord Guild custom-emoji names for each logical role key. */
export const ROLE_DISCORD_EMOJI_NAMES: Record<RoleDiscordEmojiKey, string> = {
  tank: "tank",
  healer: "healer",
  dps: "dps",
  lootbuddy: "loot",
  raidlead: "raidlead",
};

export type GuildRoleIndicators = Partial<Record<RoleDiscordEmojiKey, string>>;

async function fetchGuildEmojisByName(client: Client, guildId: string): Promise<Map<string, GuildEmoji>> {
  const guild = await client.guilds.fetch(guildId);
  await guild.emojis.fetch();

  const byName = new Map<string, GuildEmoji>();
  for (const emoji of guild.emojis.cache.values()) {
    if (emoji.name) {
      byName.set(emoji.name, emoji);
    }
  }
  return byName;
}

/**
 * Resolve Guild custom class emojis once per Discord sync render that needs them
 * (Final Setup and Signup Embed).
 * Maps WowClass → Discord custom-emoji markup (<:name:id> / <a:name:id>).
 * Missing guild emojis are omitted so the formatter falls back to class labels.
 */
export async function resolveGuildClassIndicators(
  client: Client,
  guildId: string,
): Promise<Partial<Record<WowClass, string>>> {
  const byName = await fetchGuildEmojisByName(client, guildId);

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

/**
 * Resolve Guild custom role emojis (`tank`, `healer`, `dps`, `loot`, `raidlead`)
 * for signup/roster field labels. Logical key `lootbuddy` maps to Guild emoji `loot`.
 * Missing names fall back to unicode in the embed.
 */
export async function resolveGuildRoleIndicators(
  client: Client,
  guildId: string,
): Promise<GuildRoleIndicators> {
  const byName = await fetchGuildEmojisByName(client, guildId);
  const indicators: GuildRoleIndicators = {};
  for (const key of ROLE_DISCORD_EMOJI_KEYS) {
    const emoji = byName.get(ROLE_DISCORD_EMOJI_NAMES[key]);
    if (emoji) {
      indicators[key] = emoji.toString();
    }
  }
  return indicators;
}

/** Stable fingerprint so signup posts refresh when Guild class emojis change. */
export function fingerprintClassIndicators(
  indicators: Partial<Record<WowClass, string>>,
): string {
  // Keep this compact (ids only) — full <:name:id> markup blows URL/query limits.
  return WOW_CLASSES.map((wowClass) => {
    const markup = indicators[wowClass] ?? "";
    const idMatch = /:(\d+)>/.exec(markup);
    return `${wowClass}:${idMatch?.[1] ?? ""}`;
  }).join("|");
}

/** Stable fingerprint so signup posts refresh when Guild role emojis change. */
export function fingerprintRoleIndicators(indicators: GuildRoleIndicators): string {
  return ROLE_DISCORD_EMOJI_KEYS.map((key) => {
    const markup = indicators[key] ?? "";
    const idMatch = /:(\d+)>/.exec(markup);
    return `${key}:${idMatch?.[1] ?? ""}`;
  }).join("|");
}
