/** Discord API error code: Unknown Channel */
export const DISCORD_UNKNOWN_CHANNEL_CODE = 10003;

/**
 * True when Discord confirmed the channel id does not exist (deleted / never
 * existed). Other failures (Missing Access, rate limits, network) must NOT be
 * treated as deletion — recreating would orphan live channels.
 */
export function isDiscordUnknownChannelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === DISCORD_UNKNOWN_CHANNEL_CODE || code === "10003";
}
