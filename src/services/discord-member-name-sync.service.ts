import {
  discordGuildMemberClient,
  type DiscordGuildMember,
} from "@/integrations/discord/discord-guild-member.client";
import { getDiscordRoleAccessSyncConfig } from "@/lib/discord-config";
import { realmKey, resolveDiscordDisplayName } from "@/lib/discord-display-name";
import { characterRepository } from "@/repositories/character.repository";
import { userRepository } from "@/repositories/user.repository";

/**
 * Discord → displayed player name (User.name).
 *
 * Every authoritative guild member read stores the raw Discord names
 * (server nickname, global display name, username) and writes the name
 * resolved from them (lib/discord-display-name) into User.name, which every
 * surface already shows — signups, roster, attendance, Discord posts, DMs,
 * admin views. Names are display only; identity stays the Discord user id.
 *
 * - member read (login or bot refresh) → nickname / global name / username stored, name re-resolved
 * - not in the guild (HTTP 404) → server nickname cleared (authoritative), last global name / username kept
 * - Discord unreachable / rate limited / invalid → nothing changes (last known name stays), retried later
 * - nothing resolvable → User.name unchanged
 * - a Raid Lead's not-yet-ended Runs are re-titled to the stored name
 *   (runService.retitleActiveRunsForRaidLead writes only differing titles),
 *   so Run title and Discord Run channel name stay the same name
 *
 * Reads Discord only in these two places — never while rendering.
 */

/** A name refreshed more recently than this is not read again by the bot refresh. */
export const DISCORD_NAME_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
/** Users read per bot refresh tick (sequential single-member reads, well within Discord's limits). */
export const DISCORD_NAME_REFRESH_BATCH = 10;
/** Runs that started this long ago still count as upcoming (late joiners, ongoing raids). */
const UPCOMING_RUN_GRACE_MS = 12 * 60 * 60_000;

/** Realm keys of every stored Character — what counts as a known realm suffix. */
export async function loadKnownRealmKeys(): Promise<Set<string>> {
  return new Set((await characterRepository.listDistinctRealms()).map(realmKey));
}

/** Applies one authoritative member read (null = not in the guild) to the User's stored names. */
export async function applyDiscordMemberName(
  userId: string,
  member: DiscordGuildMember | null,
  options: { now?: Date; knownRealmKeys?: ReadonlySet<string> } = {},
): Promise<void> {
  const current = await userRepository.findDiscordNameState(userId);
  if (!current) return;
  const sources = member
    ? { guildNickname: member.nick, globalName: member.globalName, username: member.username ?? current.discordUsername }
    : { guildNickname: null, globalName: current.discordGlobalName, username: current.discordUsername };
  const knownRealmKeys = options.knownRealmKeys ?? (await loadKnownRealmKeys());
  await userRepository.setDiscordName(userId, {
    name: resolveDiscordDisplayName(sources, knownRealmKeys) ?? current.name,
    discordUsername: sources.username,
    discordGlobalName: sources.globalName,
    discordGuildNickname: sources.guildNickname,
    syncedAt: (options.now ?? new Date()).toISOString(),
  });
  // Lazy: this module runs inside the Better Auth sign-in hook; keep the Run
  // service graph out of the auth module.
  const { runService } = await import("@/services/run.service");
  await runService.retitleActiveRunsForRaidLead(userId);
}

export type DiscordNameRefreshResult =
  | { status: "NOT_CONFIGURED" }
  | { status: "DONE"; refreshed: number; due: number; stoppedOnError: boolean };

export const discordMemberNameSyncService = {
  /**
   * The bot's bounded name refresh: people of upcoming Runs whose name is
   * older than a day (never read first), at most one batch per tick. A
   * Discord failure stops the pass — it is never per user (404 is handled),
   * so the remaining users keep their last known name and are retried on a
   * later tick.
   */
  async runDuePass(now: Date = new Date()): Promise<DiscordNameRefreshResult> {
    const config = getDiscordRoleAccessSyncConfig();
    if (!config) return { status: "NOT_CONFIGURED" };
    const due = await userRepository.listDueDiscordNameRefresh({
      staleBefore: new Date(now.getTime() - DISCORD_NAME_REFRESH_INTERVAL_MS).toISOString(),
      runsFrom: new Date(now.getTime() - UPCOMING_RUN_GRACE_MS).toISOString(),
      limit: DISCORD_NAME_REFRESH_BATCH,
    });
    if (due.length === 0) return { status: "DONE", refreshed: 0, due: 0, stoppedOnError: false };
    const knownRealmKeys = await loadKnownRealmKeys();
    let refreshed = 0;
    for (const user of due) {
      let member: DiscordGuildMember | null;
      try {
        member = await discordGuildMemberClient.getMember(user.discordUserId, config);
      } catch (error) {
        console.warn("[discord-name-sync] Discord member read failed; keeping last known names", error);
        return { status: "DONE", refreshed, due: due.length, stoppedOnError: true };
      }
      await applyDiscordMemberName(user.id, member, { now, knownRealmKeys });
      refreshed += 1;
    }
    return { status: "DONE", refreshed, due: due.length, stoppedOnError: false };
  },
};
