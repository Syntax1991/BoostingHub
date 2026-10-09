import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discordGuildMemberClient,
  type DiscordRoleAccessSyncConfig,
} from "@/integrations/discord/discord-guild-member.client";
import { getDiscordRoleAccessSyncConfig } from "@/lib/discord-config";

const fetchMock = vi.fn();

const config: DiscordRoleAccessSyncConfig = {
  botToken: "test-bot-token",
  guildId: "123456789012345678",
  raidBoosterRoleId: "1527022823103791104",
  lootbuddyRoleId: "1527024325306220704",
};

function memberResponse(roles: string[]): Response {
  return new Response(
    JSON.stringify({
      user: {
        id: "987654321098765432",
        username: "raidbooster",
        discriminator: "0",
        avatar: null,
        global_name: "Raid Booster",
        bot: false,
        system: false,
        flags: 0,
        public_flags: 0,
      },
      nick: null,
      avatar: null,
      banner: null,
      roles,
      joined_at: "2026-09-27T12:00:00.000Z",
      premium_since: null,
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      permissions: "0",
      communication_disabled_until: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("DISCORD_BOT_TOKEN", " test-bot-token ");
  vi.stubEnv("DISCORD_GUILD_ID", " 123456789012345678 ");
  vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", " 1527022823103791104 ");
  vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", " 1527024325306220704 ");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getDiscordRoleAccessSyncConfig", () => {
  it("returns trimmed server-only Discord configuration when every value is present", () => {
    expect(getDiscordRoleAccessSyncConfig()).toEqual(config);
  });

  it.each([
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_BOOSTER_ROLE_ID",
    "DISCORD_LOOTBUDDY_ROLE_ID",
  ])("returns null when %s is blank", (key) => {
    vi.stubEnv(key, "   ");
    expect(getDiscordRoleAccessSyncConfig()).toBeNull();
  });
});

describe("discordGuildMemberClient.listRoleIds", () => {
  it("requests the configured guild member with bot authentication and returns role ids", async () => {
    fetchMock.mockResolvedValueOnce(memberResponse(["111", config.raidBoosterRoleId]));

    await expect(discordGuildMemberClient.listRoleIds("987654321098765432", config)).resolves.toEqual([
      "111",
      config.raidBoosterRoleId,
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://discord.com/api/v10/guilds/123456789012345678/members/987654321098765432",
    );
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bot test-bot-token", Accept: "application/json" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when the Discord member does not exist", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(discordGuildMemberClient.listRoleIds("987654321098765432", config)).resolves.toBeNull();
  });

  it("rejects non-404 Discord failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(discordGuildMemberClient.listRoleIds("987654321098765432", config)).rejects.toThrow(
      "Discord HTTP 503",
    );
  });

  it("rejects a successful response without a role-id array", async () => {
    fetchMock.mockResolvedValueOnce(memberResponse([]));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ roles: [123] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(discordGuildMemberClient.listRoleIds("987654321098765432", config)).resolves.toEqual([]);
    await expect(discordGuildMemberClient.listRoleIds("987654321098765432", config)).rejects.toThrow(
      "invalid role data",
    );
  });

  it("rejects network failures without exposing the bot token", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const failure = discordGuildMemberClient.listRoleIds("987654321098765432", config);
    await expect(failure).rejects.toThrow("Discord member lookup failed");
    await expect(failure).rejects.not.toThrow(config.botToken);
  });
});
