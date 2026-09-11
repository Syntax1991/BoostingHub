/** Bot process configuration. Fails fast at startup rather than at first use. */
export type BotEnv = {
  discordBotToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  /**
   * Preferred: the parent category new per-Run text channels are created
   * under (§ per-Run channel provisioning). When unset, the bot falls back
   * to the legacy single global channel pair below — see docs/features/discord-bot.md.
   */
  discordRunCategoryId: string | null;
  /** Legacy/test fallback, used only when discordRunCategoryId is unset. */
  discordSignupChannelId: string | null;
  discordRosterChannelId: string | null;
  apiBaseUrl: string;
  botApiToken: string;
  syncIntervalMs: number;
};

const REQUIRED_VARS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
  "BOOSTINGHUB_API_BASE_URL",
  "BOOSTINGHUB_BOT_API_TOKEN",
] as const;

export function loadBotEnv(env: NodeJS.ProcessEnv = process.env): BotEnv {
  const missing = REQUIRED_VARS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required Discord bot environment variable(s): ${missing.join(", ")}`);
  }

  const runCategoryId = env.DISCORD_RUN_CATEGORY_ID?.trim() || null;
  const signupChannelId = env.DISCORD_SIGNUP_CHANNEL_ID?.trim() || null;
  const rosterChannelId = env.DISCORD_ROSTER_CHANNEL_ID?.trim() || null;

  if (!runCategoryId && !signupChannelId) {
    throw new Error(
      "Configure either DISCORD_RUN_CATEGORY_ID (preferred, per-Run channels) or DISCORD_SIGNUP_CHANNEL_ID (legacy fallback).",
    );
  }

  return {
    discordBotToken: env.DISCORD_BOT_TOKEN!,
    discordApplicationId: env.DISCORD_APPLICATION_ID!,
    discordGuildId: env.DISCORD_GUILD_ID!,
    discordRunCategoryId: runCategoryId,
    discordSignupChannelId: signupChannelId,
    discordRosterChannelId: rosterChannelId,
    apiBaseUrl: env.BOOSTINGHUB_API_BASE_URL!.replace(/\/$/, ""),
    botApiToken: env.BOOSTINGHUB_BOT_API_TOKEN!,
    syncIntervalMs: Number(env.DISCORD_SYNC_INTERVAL_MS ?? 60_000),
  };
}
