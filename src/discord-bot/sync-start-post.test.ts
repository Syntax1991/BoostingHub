import { ChannelType, Collection } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";
import { formatFinalSetupLfgLine } from "@/lib/run-start-message";
import { buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";

const CATEGORY_ID = "cat-weekly";
const GUILD_ID = "guild-1";
const CHANNEL_ID = "run-chan-1";
const CURRENT_MARKER = "marker-current";
const NEXT_MARKER = "marker-next";

function botEnv(): BotEnv {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordGuildId: GUILD_ID,
    discordRunCategoryId: CATEGORY_ID,
    discordRunCurrentMarkerChannelId: CURRENT_MARKER,
    discordRunNextMarkerChannelId: NEXT_MARKER,
    discordRunArchiveCategoryId: null,
    discordRunArchiveLogChannelId: null,
    discordPingRoleTankId: null,
    discordPingRoleHealerId: null,
    discordPingRoleDpsId: null,
    discordSignupChannelId: null,
    discordRosterChannelId: null,
    apiBaseUrl: "http://localhost",
    botApiToken: "bot-token",
    syncIntervalMs: 60_000,
  };
}

const startData = {
  runId: "run-start-1",
  runTitle: "Thu 19:00 HC Unsaved 8/8 Lead",
  raidName: "Venomous Abyss",
  productLabel: "The Venomous Abyss",
  contentSummary: "The Venomous Abyss 8/8",
  difficulty: "HEROIC" as const,
  lootType: "UNSAVED" as const,
  scheduledStartAt: "2026-09-18T17:00:00.000Z",
  raidLeadDisplayName: "Syntax",
  targets: { tanks: 2, healers: 2, dps: 8 },
  groups: {
    tanks: [
      {
        signupId: "t1",
        userId: "u1",
        userName: "Dusk",
        discordUserId: "111",
        characterName: "Duskmaven",
        characterRealm: "Draenor",
        wowClass: "SHAMAN" as const,
        classLabel: "Shaman",
        saveLabel: "Unsaved",
        participationType: "BOOSTER" as const,
        selectedRole: "TANK" as const,
      },
    ],
    healers: [],
    dps: [],
    lootbuddies: [],
  },
  totalSelected: 1,
};

describe("syncOnce — Final Setup plain-text start posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a new Start message as content only (no embeds)", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const edit = vi.fn();
    const { client } = makeStartClient({ send, edit });
    const api = makeStartApi({ existingMessageId: null });

    await syncOnce(client, botEnv(), api);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0] as { content?: string; embeds?: unknown };
    expect(payload.content).toContain("**Final Setup**");
    expect(payload.content).toContain("<@111> <:shaman:999>");
    expect(payload.content?.endsWith(formatFinalSetupLfgLine("Syntax"))).toBe(true);
    expect(payload.content?.match(/LFG HM/g)).toHaveLength(1);
    expect(payload.embeds).toBeUndefined();
    expect(edit).not.toHaveBeenCalled();
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-start-1", {
      kind: "start",
      channelId: CHANNEL_ID,
      messageId: "msg-new",
    });
  });

  it("edits an existing Start message with content and clears embeds", async () => {
    const send = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const { client } = makeStartClient({ send, edit, existingMessageId: "msg-old" });
    const api = makeStartApi({ existingMessageId: "msg-old" });

    await syncOnce(client, botEnv(), api);

    expect(edit).toHaveBeenCalledTimes(1);
    const payload = edit.mock.calls[0]![0] as { content?: string; embeds?: unknown[] };
    expect(payload.content).toContain("**Final Setup**");
    expect(payload.embeds).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-start-1", {
      kind: "start",
      channelId: CHANNEL_ID,
      messageId: "msg-old",
    });
  });
});

describe("Signup / Roster embeds unchanged by Final Setup LFG", () => {
  it("does not put the Final Setup LFG line into signup or roster embeds", () => {
    const signup = buildSignupEmbed({
      runId: "r1",
      runTitle: "Test",
      raidName: "The Venomous Abyss",
      productLabel: "The Venomous Abyss",
      contentSummary: "The Venomous Abyss 8/8",
      titleCoverage: "8/8",
      raidLeadName: "Titan",
      raidLeadDiscordUserId: null,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: "2026-09-18T17:00:00.000Z",
      runStatus: "OPEN",
      signupWindowOpen: true,
      uniqueSignupCount: 0,
      roleStatus: {
        tank: { signed: 0, picked: 0, target: 2 },
        healer: { signed: 0, picked: 0, target: 4 },
        dps: { signed: 0, picked: 0, target: 14 },
        lootbuddy: { signed: 0, picked: 0 },
      },
      members: {
        signed: { tanks: [], healers: [], dps: [], lootbuddies: [] },
        picked: { tanks: [], healers: [], dps: [], lootbuddies: [] },
      },
      discordRolePing: true,
    });
    const roster = buildRosterEmbed({
      runId: "r1",
      runTitle: "Test",
      raidName: "Venomous Abyss",
      productLabel: "The Venomous Abyss",
      contentSummary: "The Venomous Abyss 8/8",
      difficulty: "HEROIC",
      publishedAt: "2026-09-18T12:00:00.000Z",
      version: 1,
      targets: { tanks: 2, healers: 4 },
      groups: { tanks: [], healers: [], meleeDps: [], rangedDps: [], lootbuddies: [] },
      totalSelected: 0,
    });

    const signupBlob = JSON.stringify(signup.data);
    const rosterBlob = JSON.stringify(roster.data);
    // The Raid Lead LFG footer belongs to Final Setup only.
    expect(signupBlob).not.toContain("LFG HM");
    expect(rosterBlob).not.toContain("LFG HM");
    expect(signup.data.title || signup.data.description).toBeTruthy();
    expect(roster.data.title).toBeTruthy();
  });
});

function makeStartApi(input: { existingMessageId: string | null }): BotApiClient {
  return {
    listSyncWork: vi.fn().mockResolvedValue({
      channels: [],
      signups: [],
      roster: [],
      start: [
        {
          runId: "run-start-1",
          existingChannelId: CHANNEL_ID,
          existingMessageId: input.existingMessageId,
          existingRunChannelId: CHANNEL_ID,
          desiredChannelName: "thu-1900-hc-unsaved-lead",
          targetBucket: "CURRENT",
        },
      ],
    }),
    recordDiscordState: vi.fn().mockResolvedValue(undefined),
    getRosterEmbedData: vi.fn().mockResolvedValue(null),
    getRunStartEmbedData: vi.fn().mockResolvedValue(startData),
  } as unknown as BotApiClient;
}

function makeStartClient(options: {
  send: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  existingMessageId?: string;
}) {
  const channel = {
    id: CHANNEL_ID,
    name: "thu-1900-hc-unsaved-lead",
    parentId: CATEGORY_ID,
    position: 1,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    send: options.send,
    setName: vi.fn().mockResolvedValue(undefined),
    setParent: vi.fn().mockResolvedValue(undefined),
    messages: {
      fetch: vi.fn(async (id: string) => {
        if (options.existingMessageId && id === options.existingMessageId) {
          return { id, edit: options.edit };
        }
        throw new Error("missing");
      }),
    },
  };

  const emojiCache = new Map([["1", { name: "shaman", id: "999", animated: false, toString: () => "<:shaman:999>" }]]);

  const client = {
    channels: {
      cache: new Collection([[CHANNEL_ID, channel]]),
      fetch: vi.fn(async (id: string) => (id === CHANNEL_ID ? channel : null)),
    },
    guilds: {
      fetch: vi.fn(async () => ({
        emojis: {
          fetch: vi.fn().mockResolvedValue(undefined),
          cache: { values: () => emojiCache.values() },
        },
        channels: {
          cache: new Collection(),
          setPositions: vi.fn(),
          fetch: vi.fn().mockResolvedValue(new Collection()),
        },
      })),
    },
  };

  return { client: client as never };
}
