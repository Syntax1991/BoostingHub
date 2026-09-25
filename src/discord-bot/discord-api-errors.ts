/** Discord API error code: Unknown Channel */
export const DISCORD_UNKNOWN_CHANNEL_CODE = 10003;

/** Discord API error code: Cannot send messages to this user (closed DMs). */
export const DISCORD_CANNOT_DM_CODE = 50007;

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

/** True when the recipient has DMs closed / blocked the bot. */
export function isDiscordCannotDmError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === DISCORD_CANNOT_DM_CODE || code === "50007";
}

/** 50001 Missing Access, 50013 Missing Permissions. */
export function isDiscordPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 50001 || code === 50013 || code === "50001" || code === "50013";
}
