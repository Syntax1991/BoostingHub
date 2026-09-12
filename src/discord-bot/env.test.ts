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

  it("the legacy global signup channel alone satisfies startup, with the category and markers null", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_SIGNUP_CHANNEL_ID: "signup-chan-1" }));
    expect(env.discordRunCategoryId).toBeNull();
    expect(env.discordRunCurrentMarkerChannelId).toBeNull();
    expect(env.discordRunNextMarkerChannelId).toBeNull();
    expect(env.discordSignupChannelId).toBe("signup-chan-1");
  });
});
