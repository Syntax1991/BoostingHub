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

/** One authoritative guild member read: roles plus the Discord names BoostingHub displays. */
export type DiscordGuildMember = {
  roleIds: string[];
  /** Server nickname; null when none is set. */
  nick: string | null;
  /** Global display name; null when none is set. */
  globalName: string | null;
  username: string | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Minimal Discord REST client for guild member reads (login-time role and
 * name sync, the bot's bounded name refresh). It never logs or includes the
 * bot token in errors.
 */
export const discordGuildMemberClient = {
  /** The Guild's roles, for matching against the allowed ping roles. Throws on any non-authoritative answer. */
  async listRoles(
    config: Pick<DiscordRoleAccessSyncConfig, "botToken" | "guildId">,
  ): Promise<Array<{ id: string; name: string; managed: boolean }>> {
    let response: Response;
    try {
      response = await fetch(`${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(config.guildId)}/roles`, {
        method: "GET",
        headers: { Authorization: `Bot ${config.botToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Discord role lookup failed.");
    }
    if (!response.ok) throw new Error(`Discord HTTP ${response.status} during role lookup.`);
    const data = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(data)) throw invalidRoleData();
    return data.flatMap((row: unknown) => {
      const role = row as { id?: unknown; name?: unknown; managed?: unknown } | null;
      return typeof role?.id === "string" && typeof role.name === "string"
        ? [{ id: role.id, name: role.name, managed: role.managed === true }]
        : [];
    });
  },

  /**
   * The guild member, or `null` when the member is not in the guild (HTTP
   * 404). Throws on transport / non-authoritative failures (rate limits
   * included) so callers can preserve last-known Discord state.
   */
  async getMember(
    discordUserId: string,
    config: Pick<DiscordRoleAccessSyncConfig, "botToken" | "guildId">,
  ): Promise<DiscordGuildMember | null> {
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

    const member = body as { roles?: unknown; nick?: unknown; user?: unknown };
    const roles = member.roles;
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
      throw invalidRoleData();
    }
    const user = member.user && typeof member.user === "object" ? (member.user as Record<string, unknown>) : {};
    return {
      roleIds: roles as string[],
      nick: optionalString(member.nick),
      globalName: optionalString(user.global_name),
      username: optionalString(user.username),
    };
  },

  /** Guild role IDs for the member, or `null` when not in the guild (see getMember). */
  async listRoleIds(
    discordUserId: string,
    config: Pick<DiscordRoleAccessSyncConfig, "botToken" | "guildId">,
  ): Promise<string[] | null> {
    const member = await this.getMember(discordUserId, config);
    return member ? member.roleIds : null;
  },
};
