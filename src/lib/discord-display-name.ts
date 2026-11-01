import { realmSlugFromDisplayName } from "@/lib/blizzard/character-domain";

/**
 * The player name BoostingHub shows (User.name), resolved from Discord:
 * server nickname → global display name → username. A trailing
 * `-<Realm>` is dropped only when it is a known WoW realm. Display only —
 * players are always identified by their Discord user id / User id, never by
 * this name.
 */

/** Realm comparison key: Blizzard slug without separators (`Twisting Nether`, `TwistingNether`, `twisting-nether` → `twistingnether`). */
export function realmKey(realm: string): string {
  return realmSlugFromDisplayName(realm).replace(/-/g, "");
}

/**
 * Drops a trailing `-<Realm>` when that suffix is a known realm. The suffix
 * may itself contain hyphens (`Name-Twisting-Nether`); the shortest matching
 * suffix wins (`Jean-Luc-Antonidas` → `Jean-Luc`). Anything else — no match,
 * or nothing left before the hyphen — is returned unchanged; there is no
 * blanket split at a hyphen.
 */
export function stripKnownRealmSuffix(name: string, knownRealmKeys: ReadonlySet<string>): string {
  const trimmed = name.trim();
  for (let index = trimmed.lastIndexOf("-"); index > 0; index = trimmed.lastIndexOf("-", index - 1)) {
    const base = trimmed.slice(0, index).trim();
    const suffix = trimmed.slice(index + 1).trim();
    if (!base || !suffix) continue;
    if (knownRealmKeys.has(realmKey(suffix))) return base;
  }
  return trimmed;
}

export type DiscordNameSources = {
  guildNickname: string | null;
  globalName: string | null;
  username: string | null;
};

/** First non-empty Discord name (server nickname, global name, username), realm suffix stripped; null when Discord gave none. */
export function resolveDiscordDisplayName(
  sources: DiscordNameSources,
  knownRealmKeys: ReadonlySet<string>,
): string | null {
  for (const candidate of [sources.guildNickname, sources.globalName, sources.username]) {
    const value = candidate?.trim();
    if (value) return stripKnownRealmSuffix(value, knownRealmKeys);
  }
  return null;
}
