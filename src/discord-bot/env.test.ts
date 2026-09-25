import { describe, expect, it } from "vitest";
import { loadBotEnv } from "@/discord-bot/env";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_BOT_TOKEN: "token",
    DISCORD_APPLICATION_ID: "app-id",
    DISCORD_GUILD_ID: "guild-id",
    BOOSTINGHUB_API_BASE_URL: "http://localhost:3000",
    BOOSTINGHUB_BOT_API_TOKEN: "bot-token",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

describe("loadBotEnv — required variables", () => {
  it("throws listing every missing required variable", () => {
    expect(() => loadBotEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("throws when neither DISCORD_RUN_CATEGORY_ID nor the legacy signup channel is configured", () => {
    expect(() => loadBotEnv(baseEnv())).toThrow(/DISCORD_RUN_CATEGORY_ID/);
  });
});

describe("loadBotEnv — one active category plus marker channels", () => {
  it("resolves the single DISCORD_RUN_CATEGORY_ID for both CURRENT and NEXT weeks", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(env.discordRunCategoryId).toBe("category-1");
  });

  it("resolves marker channel ids independently and leaves them null when unset", () => {
    const withMarkers = loadBotEnv(
      baseEnv({
        DISCORD_RUN_CATEGORY_ID: "category-1",
        DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID: "current-marker-1",
        DISCORD_RUN_NEXT_MARKER_CHANNEL_ID: "next-marker-1",
      }),
    );
    expect(withMarkers.discordRunCurrentMarkerChannelId).toBe("current-marker-1");
    expect(withMarkers.discordRunNextMarkerChannelId).toBe("next-marker-1");

    const withoutMarkers = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(withoutMarkers.discordRunCurrentMarkerChannelId).toBeNull();
    expect(withoutMarkers.discordRunNextMarkerChannelId).toBeNull();
  });

  it("configuring markers with no DISCORD_RUN_CATEGORY_ID and no legacy signup channel still fails startup", () => {
    expect(() =>
      loadBotEnv(
        baseEnv({
          DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID: "current-marker-1",
          DISCORD_RUN_NEXT_MARKER_CHANNEL_ID: "next-marker-1",
        }),
      ),
    ).toThrow(/DISCORD_RUN_CATEGORY_ID/);
  });

  it("resolves DISCORD_RUN_ARCHIVE_CATEGORY_ID independently and leaves it null when unset", () => {
    const withArchive = loadBotEnv(
      baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_RUN_ARCHIVE_CATEGORY_ID: "archive-1" }),
    );
    expect(withArchive.discordRunArchiveCategoryId).toBe("archive-1");

    const withoutArchive = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(withoutArchive.discordRunArchiveCategoryId).toBeNull();
  });

  it("resolves DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID independently and leaves it null when unset", () => {
    const withLog = loadBotEnv(
      baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID: "log-chan-1" }),
    );
    expect(withLog.discordRunArchiveLogChannelId).toBe("log-chan-1");

    const withoutLog = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(withoutLog.discordRunArchiveLogChannelId).toBeNull();
  });

  it("resolves optional raidboost ping role ids", () => {
    const withRoles = loadBotEnv(
      baseEnv({
        DISCORD_RUN_CATEGORY_ID: "category-1",
        DISCORD_PING_ROLE_TANK_ID: "tank-1",
        DISCORD_PING_ROLE_HEALER_ID: "heal-1",
        DISCORD_PING_ROLE_DPS_ID: "dps-1",
      }),
    );
    expect(withRoles.discordPingRoleTankId).toBe("tank-1");
    expect(withRoles.discordPingRoleHealerId).toBe("heal-1");
    expect(withRoles.discordPingRoleDpsId).toBe("dps-1");

    const without = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(without.discordPingRoleTankId).toBeNull();
  });

  it("the legacy global signup channel alone satisfies startup, with the category and markers null", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_SIGNUP_CHANNEL_ID: "signup-chan-1" }));
    expect(env.discordRunCategoryId).toBeNull();
    expect(env.discordRunCurrentMarkerChannelId).toBeNull();
    expect(env.discordRunNextMarkerChannelId).toBeNull();
    expect(env.discordSignupChannelId).toBe("signup-chan-1");
  });
});

describe("loadBotEnv — temporary Run voice channels", () => {
  it("leaves DISCORD_RUN_VOICE_CATEGORY_ID null when unset or blank (feature disabled, startup ok)", () => {
    expect(loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" })).discordRunVoiceCategoryId).toBeNull();
    expect(
      loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_RUN_VOICE_CATEGORY_ID: "   " })).discordRunVoiceCategoryId,
    ).toBeNull();
  });

  it("resolves DISCORD_RUN_VOICE_CATEGORY_ID independently of the text Run category", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_RUN_VOICE_CATEGORY_ID: " voice-cat " }));
    expect(env.discordRunVoiceCategoryId).toBe("voice-cat");
    expect(env.discordRunCategoryId).toBe("category-1");
  });
});

describe("loadBotEnv — sync interval", () => {
  it("defaults to 5s so embeds refresh quickly without an explicit env override", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(env.syncIntervalMs).toBe(5_000);
  });

  it("honors DISCORD_SYNC_INTERVAL_MS when set", () => {
    const env = loadBotEnv(
      baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_SYNC_INTERVAL_MS: "15000" }),
    );
    expect(env.syncIntervalMs).toBe(15_000);
  });
});

describe("loadBotEnv — Support ticket config group", () => {
  const TICKET_ENV = {
    DISCORD_TICKET_PANEL_CHANNEL_ID: "100000000000000001",
    DISCORD_TICKET_CATEGORY_ID: "100000000000000002",
    DISCORD_TICKET_ARCHIVE_LOG_CHANNEL_ID: "100000000000000003",
    DISCORD_TICKET_ADMIN_ROLE_ID: "100000000000000004",
    DISCORD_TICKET_MODERATOR_ROLE_ID: "100000000000000005",
    DISCORD_TICKET_RAID_STAFF_ROLE_ID: "100000000000000006",
    DISCORD_TICKET_MYTHIC_PLUS_STAFF_ROLE_ID: "100000000000000007",
  };

  it("all ticket variables absent: feature disabled, bot env loads", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1" }));
    expect(env.tickets).toBeNull();
    expect(env.discordRunCategoryId).toBe("category-1");
  });

  it("whitespace-only ticket variables count as unset", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_TICKET_CATEGORY_ID: "  " }));
    expect(env.tickets).toBeNull();
  });

  it("partial ticket config fails startup naming the missing keys but no values", () => {
    const partial = { ...TICKET_ENV, DISCORD_TICKET_MODERATOR_ROLE_ID: undefined, DISCORD_TICKET_ARCHIVE_LOG_CHANNEL_ID: "" };
    let message = "";
    try {
      loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", ...partial }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/partially configured/);
    expect(message).toContain("DISCORD_TICKET_MODERATOR_ROLE_ID");
    expect(message).toContain("DISCORD_TICKET_ARCHIVE_LOG_CHANNEL_ID");
    expect(message).not.toContain("DISCORD_TICKET_ADMIN_ROLE_ID");
    expect(message).not.toContain("100000000000000004");
  });

  it("a single ticket variable alone is a partial config", () => {
    expect(() =>
      loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", DISCORD_TICKET_ADMIN_ROLE_ID: "100000000000000004" })),
    ).toThrow(/DISCORD_TICKET_PANEL_CHANNEL_ID/);
  });

  it("rejects non-snowflake ticket ids", () => {
    expect(() =>
      loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", ...TICKET_ENV, DISCORD_TICKET_ADMIN_ROLE_ID: "Phoenix Admin" })),
    ).toThrow(/DISCORD_TICKET_ADMIN_ROLE_ID/);
  });

  it("full ticket config enables the feature", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "category-1", ...TICKET_ENV }));
    expect(env.tickets).toEqual({
      panelChannelId: "100000000000000001",
      categoryId: "100000000000000002",
      archiveLogChannelId: "100000000000000003",
      adminRoleId: "100000000000000004",
      moderatorRoleId: "100000000000000005",
      raidStaffRoleId: "100000000000000006",
      mythicPlusStaffRoleId: "100000000000000007",
    });
  });
});
