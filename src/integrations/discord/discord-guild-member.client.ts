const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 10_000;

export type DiscordRoleAccessSyncConfig = {
  botToken: string;
  guildId: string;
  raidBoosterRoleId: string;
  lootbuddyRoleId: string;
};

/** @deprecated Use DiscordRoleAccessSyncConfig. */
export type DiscordBoosterRoleSyncConfig = DiscordRoleAccessSyncConfig;

function invalidRoleData(): Error {
  return new Error("Discord returned invalid role data.");
}

/**
 * Minimal Discord REST client for login-time guild-role checks. It never logs
 * or includes the bot token in errors.
 */
export const discordGuildMemberClient = {
  /**
   * Returns guild role IDs for the member, or `null` when the member is not in
   * the guild (HTTP 404). Throws on transport / non-authoritative failures so
   * callers can preserve last-known Discord grants.
   */
  async listRoleIds(
    discordUserId: string,
    config: Pick<DiscordRoleAccessSyncConfig, "botToken" | "guildId">,
  ): Promise<string[] | null> {
    const url = new URL(
      `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bot ${config.botToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Discord member lookup failed.");
    }

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Discord HTTP ${response.status} during member lookup.`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidRoleData();
    }
    if (!body || typeof body !== "object") {
      throw invalidRoleData();
    }

    const roles = (body as { roles?: unknown }).roles;
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
      throw invalidRoleData();
    }
    return roles;
  },
};
