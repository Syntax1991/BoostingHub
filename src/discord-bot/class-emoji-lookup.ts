import type { Client } from "discord.js";
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
export type GuildClassIndicators = Partial<Record<WowClass, string>>;

/** Guild custom-emoji name → Discord markup (`<:name:id>` / `<a:name:id>`). */
export type GuildEmojiSnapshot = ReadonlyMap<string, string>;

/**
 * Guild emoji metadata changes rarely; one REST fetch per Guild per 10 min
 * replaces the previous two fetches per 5 s sync pass.
 */
export const GUILD_EMOJI_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_GUILDS = 8;

/**
 * One REST fetch of the Guild's emoji collection. `guilds.fetch(id)` is served
 * from the gateway cache; `emojis.fetch()` without an id always hits REST.
 * Later emojis with a duplicate name win, as before.
 */
async function fetchGuildEmojiSnapshot(client: Client, guildId: string): Promise<GuildEmojiSnapshot> {
  const guild = await client.guilds.fetch(guildId);
  await guild.emojis.fetch();

  const byName = new Map<string, string>();
  for (const emoji of guild.emojis.cache.values()) {
    if (emoji.name) {
      byName.set(emoji.name, emoji.toString());
    }
  }
  return byName;
}

type CacheEntry = {
  /** Last successful snapshot, if any. */
  snapshot: GuildEmojiSnapshot | null;
  fetchedAt: number;
  /** Refresh in flight — concurrent callers await this instead of fetching again. */
  refresh: Promise<GuildEmojiSnapshot> | null;
};

export type GuildEmojiCache = {
  get(client: Client, guildId: string): Promise<GuildEmojiSnapshot>;
  /** Drops every entry (tests; an in-flight refresh still settles for its awaiters). */
  clear(): void;
};

/**
 * Per-Guild emoji snapshot cache with a TTL and single-flight refresh.
 * - fresh snapshot → returned, no REST call
 * - missing/expired → one fetch shared by all concurrent callers
 * - refresh fails with an earlier snapshot → warn and keep serving it; the
 *   next call retries (nothing empty is ever cached)
 * - refresh fails without one → the error propagates, nothing is cached
 * `now` is injectable so tests control time without sleeping.
 */
export function createGuildEmojiCache(
  options: { ttlMs?: number; now?: () => number; maxGuilds?: number } = {},
): GuildEmojiCache {
  const ttlMs = options.ttlMs ?? GUILD_EMOJI_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const maxGuilds = options.maxGuilds ?? MAX_CACHED_GUILDS;
  const entries = new Map<string, CacheEntry>();

  /** Drops expired idle entries, then the oldest idle ones beyond the bound. */
  function prune(at: number, keep: string): void {
    for (const [guildId, entry] of entries) {
      if (guildId !== keep && !entry.refresh && at - entry.fetchedAt >= ttlMs) entries.delete(guildId);
    }
    for (const [guildId, entry] of entries) {
      if (entries.size < maxGuilds) break;
      if (guildId !== keep && !entry.refresh) entries.delete(guildId);
    }
  }

  return {
    async get(client, guildId) {
      const at = now();
      const entry = entries.get(guildId);
      if (entry?.snapshot && at - entry.fetchedAt < ttlMs) return entry.snapshot;
      if (entry?.refresh) return entry.refresh;

      prune(at, guildId);
      const previous = entry?.snapshot ? { snapshot: entry.snapshot, fetchedAt: entry.fetchedAt } : null;
      const refresh = fetchGuildEmojiSnapshot(client, guildId).then(
        (snapshot) => {
          // Re-insert so Map order reflects recency for pruning.
          entries.delete(guildId);
          entries.set(guildId, { snapshot, fetchedAt: now(), refresh: null });
          return snapshot;
        },
        (error: unknown) => {
          if (previous) {
            // Keep the old snapshot and its age: the next call retries.
            entries.set(guildId, { ...previous, refresh: null });
            console.warn(`[discord-bot] guild emoji refresh failed for ${guildId} — keeping previous snapshot`, error);
            return previous.snapshot;
          }
          entries.delete(guildId);
          throw error;
        },
      );
      entries.set(guildId, { snapshot: previous?.snapshot ?? null, fetchedAt: previous?.fetchedAt ?? 0, refresh });
      return refresh;
    },
    clear() {
      entries.clear();
    },
  };
}

/** Maps WowClass → emoji markup. Missing emojis are omitted so formatters fall back to class labels. */
export function buildClassIndicators(snapshot: GuildEmojiSnapshot): GuildClassIndicators {
  const indicators: GuildClassIndicators = {};
  for (const wowClass of WOW_CLASSES) {
    const markup = snapshot.get(CLASS_DISCORD_EMOJI_NAMES[wowClass]);
    if (markup) indicators[wowClass] = markup;
  }
  return indicators;
}

/**
 * Role emojis (`tank`, `healer`, `dps`, `loot`, `raidlead`) for signup/roster
 * field labels. Logical key `lootbuddy` maps to Guild emoji `loot`. Missing
 * names are omitted so the embed falls back to unicode.
 */
export function buildRoleIndicators(snapshot: GuildEmojiSnapshot): GuildRoleIndicators {
  const indicators: GuildRoleIndicators = {};
  for (const key of ROLE_DISCORD_EMOJI_KEYS) {
    const markup = snapshot.get(ROLE_DISCORD_EMOJI_NAMES[key]);
    if (markup) indicators[key] = markup;
  }
  return indicators;
}

const defaultGuildEmojiCache = createGuildEmojiCache();

/** Resets the process-wide cache so sync tests stay independent of each other. */
export function clearGuildEmojiCache(): void {
  defaultGuildEmojiCache.clear();
}

/**
 * Class and role indicators from ONE cached Guild emoji snapshot — a sync
 * pass needs at most one emoji REST fetch, and usually none.
 */
export async function resolveGuildEmojiIndicators(
  client: Client,
  guildId: string,
  cache: GuildEmojiCache = defaultGuildEmojiCache,
): Promise<{ classIndicators: GuildClassIndicators; roleIndicators: GuildRoleIndicators }> {
  const snapshot = await cache.get(client, guildId);
  return { classIndicators: buildClassIndicators(snapshot), roleIndicators: buildRoleIndicators(snapshot) };
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
