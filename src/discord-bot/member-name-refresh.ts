/** Cadence of the Discord player name refresh trigger. */
export const DISCORD_MEMBER_NAME_REFRESH_INTERVAL_MS = 10 * 60_000;

/**
 * Periodically ask the API to refresh due Discord player names (server
 * nickname, global name, username). The API decides who is due and reads
 * Discord; the bot only ticks, one request at a time.
 */
export function startMemberNameRefreshLoop(api: { refreshDiscordMemberNames(): Promise<unknown> }): NodeJS.Timeout {
  let inFlight = false;
  return setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    api
      .refreshDiscordMemberNames()
      .catch((error) => console.error("[discord-bot] Discord member name refresh trigger failed", error))
      .finally(() => {
        inFlight = false;
      });
  }, DISCORD_MEMBER_NAME_REFRESH_INTERVAL_MS);
}
