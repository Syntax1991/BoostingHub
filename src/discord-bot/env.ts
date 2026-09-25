/** Bot process configuration. Fails fast at startup rather than at first use. */
export type BotEnv = {
  discordBotToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  /**
   * Preferred: the ONE parent category new per-Run text channels are created
   * under (e.g. "Weekly Raid Schedule"). CURRENT and NEXT raid-ID weeks share
   * this same category — Discord channels cannot contain child channels, so
   * the two weeks are visually separated by ordering/position within this
   * category, anchored by the two marker channels below, not by separate
   * categories (§ weekly raid-ID sections). When unset, the bot falls back
   * to the legacy single global channel pair further below.
   */
  discordRunCategoryId: string | null;
  /**
   * The manually-managed `#current-id` text channel inside
   * `discordRunCategoryId` — a stable ordering anchor, never a Run channel.
   * BoostingHub never creates, renames, deletes, or repositions this channel
   * itself; it only reads its live `position` to know where the CURRENT
   * section starts. Required for CURRENT-section position reconciliation —
   * when unset, that reconciliation is skipped with a warning (channels
   * still get the correct parent category and name, just not corrected
   * ordering) rather than guessing a replacement anchor.
   */
  discordRunCurrentMarkerChannelId: string | null;
  /** Same role as `discordRunCurrentMarkerChannelId`, for the NEXT section (`#next-id`). */
  discordRunNextMarkerChannelId: string | null;
  /**
   * Where PAST/FUTURE holding channels move (schedule ARCHIVE, not app-archive).
   * App-archived Runs are never moved here — they get a transcript then the
   * Discord channel is deleted. Optional — when unset, holding moves are
   * skipped with a warning.
   */
  discordRunArchiveCategoryId: string | null;
  /**
   * Central Ticket-Tool-style archive log channel (e.g. `#raid-open-channel-logs`).
   * App-archive posts Server-Info + HTML transcript + details embed here once,
   * then deletes the Run channel. Optional — when unset, archive artifacts are
   * skipped with a warning and the channel is left until a later successful post.
   */
  discordRunArchiveLogChannelId: string | null;
  /**
   * Dedicated Guild Category for temporary per-Run GuildVoice channels
   * ("Raid with <Raid Lead>"). Never the text Run category. Optional — when
   * unset/undefined the voice feature is disabled and nothing is created.
   */
  discordRunVoiceCategoryId?: string | null;
  /**
   * Optional snowflake overrides for Raidboost Announce pings. When unset, the
   * bot resolves Guild roles named `tank` / `healer` / `dps` (case-insensitive).
   */
  discordPingRoleTankId: string | null;
  discordPingRoleHealerId: string | null;
  discordPingRoleDpsId: string | null;
  /** Legacy/test fallback, used only when discordRunCategoryId is unset. */
  discordSignupChannelId: string | null;
  discordRosterChannelId: string | null;
  apiBaseUrl: string;
  botApiToken: string;
  syncIntervalMs: number;
  /**
   * Discord Support ticket system. Null (feature off) when every ticket
   * variable is unset; startup fails when only some are set — a partial
   * config could post a panel whose tickets are visible to the wrong roles.
   */
  tickets?: BotTicketEnv | null;
};

export type BotTicketEnv = {
  panelChannelId: string;
  /** Category every active ticket channel is created under. */
  categoryId: string;
  /** Staff-only channel receiving summary + HTML transcript on close. */
  archiveLogChannelId: string;
  adminRoleId: string;
  moderatorRoleId: string;
  raidStaffRoleId: string;
  mythicPlusStaffRoleId: string;
};

/** The ticket feature's config group — all or nothing. */
export const TICKET_ENV_KEYS = {
  panelChannelId: "DISCORD_TICKET_PANEL_CHANNEL_ID",
  categoryId: "DISCORD_TICKET_CATEGORY_ID",
  archiveLogChannelId: "DISCORD_TICKET_ARCHIVE_LOG_CHANNEL_ID",
  adminRoleId: "DISCORD_TICKET_ADMIN_ROLE_ID",
  moderatorRoleId: "DISCORD_TICKET_MODERATOR_ROLE_ID",
  raidStaffRoleId: "DISCORD_TICKET_RAID_STAFF_ROLE_ID",
  mythicPlusStaffRoleId: "DISCORD_TICKET_MYTHIC_PLUS_STAFF_ROLE_ID",
} as const satisfies Record<keyof BotTicketEnv, string>;

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/**
 * Resolves the ticket config group. Error messages name keys only, never
 * values.
 */
export function loadTicketEnv(env: NodeJS.ProcessEnv): BotTicketEnv | null {
  const entries = Object.entries(TICKET_ENV_KEYS) as Array<[keyof BotTicketEnv, string]>;
  const values = entries.map(([field, key]) => [field, key, env[key]?.trim() ?? ""] as const);
  const configured = values.filter(([, , value]) => value);
  if (configured.length === 0) return null;

  const missing = values.filter(([, , value]) => !value).map(([, key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `Discord ticket system is partially configured. Set all ticket variables or none. Missing: ${missing.join(", ")}`,
    );
  }
  const invalid = values.filter(([, , value]) => !SNOWFLAKE_PATTERN.test(value)).map(([, key]) => key);
  if (invalid.length > 0) {
    throw new Error(`Discord ticket variable(s) must be Discord ids (17–20 digits): ${invalid.join(", ")}`);
  }
  return Object.fromEntries(values.map(([field, , value]) => [field, value])) as BotTicketEnv;
}

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
  const currentMarkerChannelId = env.DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID?.trim() || null;
  const nextMarkerChannelId = env.DISCORD_RUN_NEXT_MARKER_CHANNEL_ID?.trim() || null;
  const runArchiveCategoryId = env.DISCORD_RUN_ARCHIVE_CATEGORY_ID?.trim() || null;
  const runArchiveLogChannelId = env.DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID?.trim() || null;
  const runVoiceCategoryId = env.DISCORD_RUN_VOICE_CATEGORY_ID?.trim() || null;
  const pingRoleTankId = env.DISCORD_PING_ROLE_TANK_ID?.trim() || null;
  const pingRoleHealerId = env.DISCORD_PING_ROLE_HEALER_ID?.trim() || null;
  const pingRoleDpsId = env.DISCORD_PING_ROLE_DPS_ID?.trim() || null;
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
    discordRunCurrentMarkerChannelId: currentMarkerChannelId,
    discordRunNextMarkerChannelId: nextMarkerChannelId,
    discordRunArchiveCategoryId: runArchiveCategoryId,
    discordRunArchiveLogChannelId: runArchiveLogChannelId,
    discordRunVoiceCategoryId: runVoiceCategoryId,
    discordPingRoleTankId: pingRoleTankId,
    discordPingRoleHealerId: pingRoleHealerId,
    discordPingRoleDpsId: pingRoleDpsId,
    discordSignupChannelId: signupChannelId,
    discordRosterChannelId: rosterChannelId,
    apiBaseUrl: env.BOOSTINGHUB_API_BASE_URL!.replace(/\/$/, ""),
    botApiToken: env.BOOSTINGHUB_BOT_API_TOKEN!,
    syncIntervalMs: Number(env.DISCORD_SYNC_INTERVAL_MS ?? 5_000),
    tickets: loadTicketEnv(env),
  };
}
