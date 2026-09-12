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

  it("throws when neither a CURRENT category nor the legacy signup channel is configured", () => {
    expect(() => loadBotEnv(baseEnv())).toThrow(/DISCORD_RUN_CURRENT_CATEGORY_ID/);
  });
});

describe("loadBotEnv — CURRENT/NEXT/ARCHIVE category resolution", () => {
  it("resolves DISCORD_RUN_CURRENT_CATEGORY_ID and DISCORD_RUN_NEXT_CATEGORY_ID as explicit, independent values", () => {
    const env = loadBotEnv(
      baseEnv({ DISCORD_RUN_CURRENT_CATEGORY_ID: "current-1", DISCORD_RUN_NEXT_CATEGORY_ID: "next-1" }),
    );
    expect(env.discordRunCurrentCategoryId).toBe("current-1");
    expect(env.discordRunNextCategoryId).toBe("next-1");
  });

  it("resolves DISCORD_RUN_ARCHIVE_CATEGORY_ID independently and leaves it null when unset", () => {
    const withArchive = loadBotEnv(
      baseEnv({ DISCORD_RUN_CURRENT_CATEGORY_ID: "current-1", DISCORD_RUN_ARCHIVE_CATEGORY_ID: "archive-1" }),
    );
    expect(withArchive.discordRunArchiveCategoryId).toBe("archive-1");

    const withoutArchive = loadBotEnv(baseEnv({ DISCORD_RUN_CURRENT_CATEGORY_ID: "current-1" }));
    expect(withoutArchive.discordRunArchiveCategoryId).toBeNull();
  });

  it("NEXT is null when unset — it never silently falls back to CURRENT or the legacy variable", () => {
    const env = loadBotEnv(
      baseEnv({ DISCORD_RUN_CURRENT_CATEGORY_ID: "current-1", DISCORD_RUN_CATEGORY_ID: "legacy-1" }),
    );
    expect(env.discordRunNextCategoryId).toBeNull();
    expect(env.discordRunCurrentCategoryId).toBe("current-1");
  });

  it("legacy DISCORD_RUN_CATEGORY_ID resolves CURRENT only when the explicit variable is unset", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_CATEGORY_ID: "legacy-1" }));
    expect(env.discordRunCurrentCategoryId).toBe("legacy-1");
    expect(env.discordRunNextCategoryId).toBeNull();
  });

  it("the explicit DISCORD_RUN_CURRENT_CATEGORY_ID takes priority over the legacy variable when both are set", () => {
    const env = loadBotEnv(
      baseEnv({ DISCORD_RUN_CURRENT_CATEGORY_ID: "explicit-1", DISCORD_RUN_CATEGORY_ID: "legacy-1" }),
    );
    expect(env.discordRunCurrentCategoryId).toBe("explicit-1");
  });

  it("configuring only DISCORD_RUN_NEXT_CATEGORY_ID succeeds at startup — CURRENT resolution failures are reported per-Run at reconciliation time, not as a hard startup failure", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_RUN_NEXT_CATEGORY_ID: "next-1" }));
    expect(env.discordRunNextCategoryId).toBe("next-1");
    expect(env.discordRunCurrentCategoryId).toBeNull();
  });

  it("the legacy global signup channel alone satisfies startup, with both category ids null", () => {
    const env = loadBotEnv(baseEnv({ DISCORD_SIGNUP_CHANNEL_ID: "signup-chan-1" }));
    expect(env.discordRunCurrentCategoryId).toBeNull();
    expect(env.discordRunNextCategoryId).toBeNull();
    expect(env.discordSignupChannelId).toBe("signup-chan-1");
  });
});
