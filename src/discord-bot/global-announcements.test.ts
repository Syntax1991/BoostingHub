import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOSTER_GUIDE_ANNOUNCEMENT_URL,
  GUIDE_CHANNEL_IDS,
  MANAWYRM_HUB_GUILD_ID,
} from "@/discord-bot/guide-channels";
import {
  GLOBAL_ANNOUNCEMENT_ALLOWED_MENTIONS,
  QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY,
  buildQuickSignupReleaseAnnouncementContent,
  syncGlobalAnnouncements,
} from "@/discord-bot/global-announcements";
import { loadBotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";

const ANNOUNCEMENT_CHANNEL_ID = "1526995703308615732";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Quick Signup release announcement — content", () => {
  it("includes Quick Signup and the Booster Guide URL from GUIDE_CHANNEL_IDS.booster", () => {
    const content = buildQuickSignupReleaseAnnouncementContent();
    expect(content).toContain("Quick Signup");
    expect(GUIDE_CHANNEL_IDS.booster).toBe("1552712971543650425");
    expect(BOOSTER_GUIDE_ANNOUNCEMENT_URL).toBe(
      `https://discord.com/channels/${MANAWYRM_HUB_GUILD_ID}/${GUIDE_CHANNEL_IDS.booster}`,
    );
    expect(content).toContain(BOOSTER_GUIDE_ANNOUNCEMENT_URL);
    expect(content).toContain("https://discord.com/channels/1526980319826280509/1552712971543650425");
    expect(content).not.toContain("<#1526998141159735498>");
    expect(QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY).toBe("quick-signup-release-v1");
  });

  it("reflects saved / non-conflicting inclusion and conflicting-reservation skip wording", () => {
    const content = buildQuickSignupReleaseAnnouncementContent();
    expect(content).toContain("Saved characters");
    expect(content).toContain("non-conflicting runs");
    expect(content).toContain("conflicting run");
    expect(content).not.toContain("Unavailable or already reserved characters are skipped");
    expect(content).toContain("Quick Signup");
    expect(content).toContain(BOOSTER_GUIDE_ANNOUNCEMENT_URL);
  });
});

describe("syncGlobalAnnouncements", () => {
  function makeClient(options: {
    channelId?: string;
    textBased?: boolean;
    send?: ReturnType<typeof vi.fn>;
    fetchRejects?: Error;
  } = {}) {
    const channelId = options.channelId ?? ANNOUNCEMENT_CHANNEL_ID;
    const send =
      options.send ??
      vi.fn().mockResolvedValue({ id: "msg-announcement-1" });
    const channel =
      options.textBased === false
        ? { id: channelId, isTextBased: () => false }
        : {
            id: channelId,
            isTextBased: () => true,
            send,
          };
    const fetch = options.fetchRejects
      ? vi.fn().mockRejectedValue(options.fetchRejects)
      : vi.fn().mockResolvedValue(channel);
    return {
      client: { channels: { fetch } } as unknown as Client,
      send,
      fetch,
    };
  }

  function makeApi(recorded = false) {
    return {
      getGlobalAnnouncement: vi.fn().mockResolvedValue(
        recorded
          ? {
              recorded: true,
              key: QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY,
              channelId: ANNOUNCEMENT_CHANNEL_ID,
              messageId: "already-sent",
            }
          : { recorded: false },
      ),
      recordGlobalAnnouncement: vi.fn().mockResolvedValue({
        recorded: true,
        created: true,
        key: QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY,
        channelId: ANNOUNCEMENT_CHANNEL_ID,
        messageId: "msg-announcement-1",
      }),
    };
  }

  it("1. env unset → no send", async () => {
    const { client, send } = makeClient();
    const api = makeApi(false);
    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: null }, api);
    expect(api.getGlobalAnnouncement).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("2–6. configured and unsent → one send to destination with content + persist key", async () => {
    const { client, send } = makeClient();
    const api = makeApi(false);
    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api);

    expect(api.getGlobalAnnouncement).toHaveBeenCalledWith("quick-signup-release-v1");
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(payload.content).toContain("Quick Signup");
    expect(payload.content).toContain(
      "https://discord.com/channels/1526980319826280509/1552712971543650425",
    );
    expect(payload.allowedMentions).toEqual({ ...GLOBAL_ANNOUNCEMENT_ALLOWED_MENTIONS });
    expect(api.recordGlobalAnnouncement).toHaveBeenCalledWith({
      key: "quick-signup-release-v1",
      channelId: ANNOUNCEMENT_CHANNEL_ID,
      messageId: "msg-announcement-1",
    });
  });

  it("7–8 / 12. subsequent poll / restart / deleted message → no duplicate when recorded", async () => {
    const { client, send } = makeClient();
    const api = makeApi(true);
    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api);
    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api);
    expect(send).not.toHaveBeenCalled();
    expect(api.recordGlobalAnnouncement).not.toHaveBeenCalled();
  });

  it("9–10. send failure → no persist; later retry can send once", async () => {
    const failingSend = vi.fn().mockRejectedValueOnce(new Error("send failed")).mockResolvedValueOnce({
      id: "msg-retry-1",
    });
    const { client } = makeClient({ send: failingSend });
    const api = makeApi(false);

    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api);
    expect(api.recordGlobalAnnouncement).not.toHaveBeenCalled();

    await syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api);
    expect(failingSend).toHaveBeenCalledTimes(2);
    expect(api.recordGlobalAnnouncement).toHaveBeenCalledWith({
      key: "quick-signup-release-v1",
      channelId: ANNOUNCEMENT_CHANNEL_ID,
      messageId: "msg-retry-1",
    });
  });

  it("11. invalid/non-text channel → no crash, no persist", async () => {
    const { client, send } = makeClient({ textBased: false });
    const api = makeApi(false);
    await expect(
      syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(api.recordGlobalAnnouncement).not.toHaveBeenCalled();
  });

  it("inaccessible channel fetch → no crash, no persist", async () => {
    const { client } = makeClient({ fetchRejects: new Error("Unknown Channel") });
    const api = makeApi(false);
    await expect(
      syncGlobalAnnouncements(client, { discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID }, api),
    ).resolves.toBeUndefined();
    expect(api.recordGlobalAnnouncement).not.toHaveBeenCalled();
  });
});

describe("syncOnce — announcement failure does not block Discord sync", () => {
  it("13. announcement failure → normal sync continues", async () => {
    const { Collection } = await import("discord.js");
    const { clearGuildEmojiCache } = await import("@/discord-bot/class-emoji-lookup");
    clearGuildEmojiCache();

    const getGlobalAnnouncement = vi.fn().mockRejectedValue(new Error("api down"));
    const listSyncWork = vi.fn().mockResolvedValue({
      channels: [],
      voiceChannels: [],
      signups: [],
      roster: [],
      start: [],
      raidInvites: [],
      notificationDms: [],
      runAnnouncements: [],
    });
    const api = {
      listSyncWork,
      getGlobalAnnouncement,
      recordGlobalAnnouncement: vi.fn(),
      recordDiscordState: vi.fn(),
      getRosterEmbedData: vi.fn(),
      getRunStartEmbedData: vi.fn(),
    } as unknown as BotApiClient;

    const guild = {
      id: "guild",
      emojis: { fetch: vi.fn(async () => undefined), cache: new Collection() },
      roles: { fetch: vi.fn(async () => new Collection()), cache: new Collection() },
      channels: { cache: new Collection(), setPositions: vi.fn(), fetch: vi.fn(async () => new Collection()) },
    };
    const client = {
      channels: { cache: new Collection(), fetch: vi.fn(async () => null) },
      users: { fetch: vi.fn() },
      guilds: { fetch: vi.fn(async () => guild) },
    } as unknown as Client;

    const env: BotEnv = {
      discordBotToken: "token",
      discordApplicationId: "app",
      discordGuildId: "guild",
      discordRunCategoryId: "category",
      discordRunCurrentMarkerChannelId: null,
      discordRunNextMarkerChannelId: null,
      discordRunArchiveCategoryId: null,
      discordRunArchiveLogChannelId: null,
      discordPingRoleTankId: null,
      discordPingRoleHealerId: null,
      discordPingRoleDpsId: null,
      discordAnnouncementChannelId: ANNOUNCEMENT_CHANNEL_ID,
      discordSignupChannelId: null,
      discordRosterChannelId: null,
      apiBaseUrl: "http://localhost",
      botApiToken: "bot-token",
      syncIntervalMs: 60_000,
    };

    await expect(syncOnce(client, env, api)).resolves.toBeUndefined();
    expect(listSyncWork).toHaveBeenCalled();
    expect(getGlobalAnnouncement).toHaveBeenCalledWith("quick-signup-release-v1");
  });
});

describe("loadBotEnv — announcement channel optional", () => {
  it("startup succeeds when DISCORD_ANNOUNCEMENT_CHANNEL_ID is unset", () => {
    const env = loadBotEnv({
      DISCORD_BOT_TOKEN: "token",
      DISCORD_APPLICATION_ID: "app",
      DISCORD_GUILD_ID: "guild",
      DISCORD_RUN_CATEGORY_ID: "category",
      BOOSTINGHUB_API_BASE_URL: "http://localhost:3000",
      BOOSTINGHUB_BOT_API_TOKEN: "bot-token",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.discordAnnouncementChannelId).toBeNull();
  });
});
