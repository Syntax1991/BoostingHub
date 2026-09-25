import { Collection } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { clearGuildEmojiCache } from "@/discord-bot/class-emoji-lookup";
import type { BotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";

beforeEach(() => clearGuildEmojiCache());

const GUILD_ID = "guild-emoji-cache";

function emoji(name: string, id: string) {
  return { name, id, toString: () => `<:${name}:${id}>` };
}

function makeClient() {
  const emojiFetch = vi.fn(async () => undefined);
  const guild = {
    id: GUILD_ID,
    emojis: {
      fetch: emojiFetch,
      cache: new Collection([
        ["1", emoji("shaman", "123")],
        ["2", emoji("tank", "11")],
      ]),
    },
    roles: { fetch: vi.fn(async () => new Collection()), cache: new Collection() },
    channels: { cache: new Collection(), setPositions: vi.fn(), fetch: vi.fn(async () => new Collection()) },
  };
  const client = {
    channels: { cache: new Collection(), fetch: vi.fn(async () => null) },
    users: { fetch: vi.fn() },
    guilds: { fetch: vi.fn(async () => guild) },
  };
  return { client: client as never, emojiFetch };
}

function makeApi() {
  return {
    listSyncWork: vi.fn(async () => ({
      channels: [],
      voiceChannels: [],
      signups: [],
      roster: [],
      start: [],
      raidInvites: [],
      notificationDms: [],
      runAnnouncements: [],
    })),
    recordDiscordState: vi.fn(),
  } as unknown as BotApiClient & { listSyncWork: ReturnType<typeof vi.fn> };
}

const env = {
  discordGuildId: GUILD_ID,
  discordRunCategoryId: "cat",
  discordRunCurrentMarkerChannelId: null,
  discordRunNextMarkerChannelId: null,
  discordRunArchiveCategoryId: null,
  discordRunArchiveLogChannelId: null,
  discordRunVoiceCategoryId: null,
  discordPingRoleTankId: null,
  discordPingRoleHealerId: null,
  discordPingRoleDpsId: null,
  discordSignupChannelId: null,
  discordRosterChannelId: null,
  syncIntervalMs: 5000,
} as unknown as BotEnv;

describe("syncOnce — Guild emoji REST fetches", () => {
  it("one pass fetches the Guild emoji collection once (not once per indicator type)", async () => {
    const { client, emojiFetch } = makeClient();
    const api = makeApi();

    await syncOnce(client, env, api);

    expect(emojiFetch).toHaveBeenCalledTimes(1);
    // Both class and role indicators came from that one snapshot.
    expect(api.listSyncWork).toHaveBeenCalledWith(expect.stringMatching(/SHAMAN:123.*\|\|.*tank:11/));
  });

  it("following passes within the TTL reuse the snapshot: zero emoji REST fetches", async () => {
    const { client, emojiFetch } = makeClient();
    const api = makeApi();

    await syncOnce(client, env, api);
    await syncOnce(client, env, api);
    await syncOnce(client, env, api);

    expect(emojiFetch).toHaveBeenCalledTimes(1);
    const fingerprints = api.listSyncWork.mock.calls.map((call) => call[0]);
    expect(new Set(fingerprints).size).toBe(1);
  });
});
