/** Bot process configuration. Fails fast at startup rather than at first use. */
export type BotEnv = {
  discordBotToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  discordSignupChannelId: string;
  discordRosterChannelId: string;
  apiBaseUrl: string;
  botApiToken: string;
  syncIntervalMs: number;
};

const REQUIRED_VARS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_SIGNUP_CHANNEL_ID",
  "DISCORD_ROSTER_CHANNEL_ID",
  "BOOSTINGHUB_API_BASE_URL",
  "BOOSTINGHUB_BOT_API_TOKEN",
] as const;

export function loadBotEnv(env: NodeJS.ProcessEnv = process.env): BotEnv {
  const missing = REQUIRED_VARS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required Discord bot environment variable(s): ${missing.join(", ")}`);
  }

  return {
    discordBotToken: env.DISCORD_BOT_TOKEN!,
    discordApplicationId: env.DISCORD_APPLICATION_ID!,
    discordGuildId: env.DISCORD_GUILD_ID!,
    discordSignupChannelId: env.DISCORD_SIGNUP_CHANNEL_ID!,
    discordRosterChannelId: env.DISCORD_ROSTER_CHANNEL_ID!,
    apiBaseUrl: env.BOOSTINGHUB_API_BASE_URL!.replace(/\/$/, ""),
    botApiToken: env.BOOSTINGHUB_BOT_API_TOKEN!,
    syncIntervalMs: Number(env.DISCORD_SYNC_INTERVAL_MS ?? 60_000),
  };
}
