/** Discord API error code: Unknown Channel */
export const DISCORD_UNKNOWN_CHANNEL_CODE = 10003;

/** Discord API error code: Unknown Message */
export const DISCORD_UNKNOWN_MESSAGE_CODE = 10008;

/** Discord API error code: Cannot send messages to this user (closed DMs). */
export const DISCORD_CANNOT_DM_CODE = 50007;

/**
 * Discord API error code: Cannot send messages to this user due to having no
 * mutual guilds (the recipient left every guild the bot shares).
 */
export const DISCORD_NO_MUTUAL_GUILDS_CODE = 50278;

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

/**
 * True when Discord confirmed the message id does not exist (deleted / never
 * existed). Transient/network/permission failures must NOT be treated as
 * deletion — recreating would duplicate Schedule (or other) posts.
 */
export function isDiscordUnknownMessageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === DISCORD_UNKNOWN_MESSAGE_CODE || code === "10008";
}

/**
 * True when Discord refuses a DM to this recipient: DMs closed / bot blocked
 * (50007) or no mutual guild left (50278). Both are recipient-side and do not
 * resolve by retrying the same message.
 */
export function isDiscordCannotDmError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === DISCORD_CANNOT_DM_CODE ||
    code === "50007" ||
    code === DISCORD_NO_MUTUAL_GUILDS_CODE ||
    code === "50278"
  );
}

/** 50001 Missing Access, 50013 Missing Permissions. */
export function isDiscordPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 50001 || code === 50013 || code === "50001" || code === "50013";
}

/**
 * Permanent DM delivery failure — the one classification every DM lane uses
 * to stop retrying. Rate limits, 5xx, network/timeouts and unknown codes stay
 * retryable (they are not matched here).
 */
export function isDiscordPermanentDmError(error: unknown): boolean {
  return isDiscordCannotDmError(error) || isDiscordPermissionError(error);
}
