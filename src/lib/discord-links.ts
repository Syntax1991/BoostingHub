/** Discord ids are numeric snowflakes; anything else never becomes a link. */
const SNOWFLAKE = /^\d{5,25}$/;

/**
 * Deep link into a Run's Discord channel, or null when there is nothing to
 * link: no guild configured, no channel recorded yet (DRAFT Runs get none),
 * or the Run is archived (archival retires and deletes the channel).
 * Public ids only — safe to send to any viewer of the Run.
 */
export function runDiscordChannelUrl(input: {
  guildId: string | null | undefined;
  runChannelId: string | null | undefined;
  archivedAt: string | null | undefined;
}): string | null {
  const guildId = input.guildId?.trim();
  const channelId = input.runChannelId?.trim();
  if (!guildId || !channelId || input.archivedAt) return null;
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}
