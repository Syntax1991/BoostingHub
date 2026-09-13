import { ChannelType, Collection } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";

const CATEGORY_ID = "cat-weekly";
const GUILD_ID = "guild-1";
const CURRENT_MARKER = "marker-current";
const NEXT_MARKER = "marker-next";

type Child = {
  id: string;
  name: string;
  parentId: string;
  position: number;
  type: number;
};

function botEnv(): BotEnv {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordGuildId: GUILD_ID,
    discordRunCategoryId: CATEGORY_ID,
    discordRunCurrentMarkerChannelId: CURRENT_MARKER,
    discordRunNextMarkerChannelId: NEXT_MARKER,
    discordRunArchiveCategoryId: null,
    discordSignupChannelId: null,
    discordRosterChannelId: null,
    apiBaseUrl: "http://localhost",
    botApiToken: "bot-token",
    syncIntervalMs: 60_000,
  };
}

function signupEmbed(runId: string, scheduledStartAt: string) {
  return {
    runId,
    runTitle: "Test Run",
    raidId: "raid-1",
    raidName: "The Venomous Abyss",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: 8,
    totalBossCount: 8,
    scheduledStartAt,
    runStatus: "OPEN",
    signupWindowOpen: true,
    uniqueSignupCount: 0,
  };
}

describe("syncOnce — same-pass first-channel positioning", () => {
  it("positions a brand-new CURRENT channel between markers in the SAME pass (no second syncOnce)", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const setPositions = vi.fn(async (moves: Array<{ channel: string; position: number }>) => {
      for (const move of moves) {
        const child = children.get(move.channel);
        if (child) child.position = move.position;
      }
    });
    const { client, createdIds } = makeDiscordClient(children, setPositions);
    const api = makeApi({
      channels: [],
      signups: [
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
          // Monday 14 Sep 2026 02:00 Europe/Berlin
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-14T00:00:00.000Z"),
        },
      ],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    expect(createdIds).toHaveLength(1);
    expect(setPositions).toHaveBeenCalledTimes(1);
    const order = orderedIds(firstSetPositionsPayload(setPositions));
    expect(order).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });

  it("positions a brand-new NEXT channel below #next-id in the SAME pass", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const setPositions = vi.fn(async (moves: Array<{ channel: string; position: number }>) => {
      for (const move of moves) {
        const child = children.get(move.channel);
        if (child) child.position = move.position;
      }
    });
    const { client, createdIds } = makeDiscordClient(children, setPositions);
    const api = makeApi({
      channels: [],
      signups: [
        {
          runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "wed-2000-hc-unsaved-lead",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-16T18:00:00.000Z",
          embed: signupEmbed("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-09-16T18:00:00.000Z"),
        },
      ],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    expect(createdIds).toHaveLength(1);
    // Discord's default create position is already below #next-id, so setPositions
    // may be a no-op — either way the same-pass ending order must be correct.
    if (setPositions.mock.calls.length > 0) {
      const order = orderedIds(firstSetPositionsPayload(setPositions));
      expect(order).toEqual([CURRENT_MARKER, NEXT_MARKER, createdIds[0]]);
    } else {
      const byPos = [...children.values()].sort((a, b) => a.position - b.position).map((c) => c.id);
      expect(byPos).toEqual([CURRENT_MARKER, NEXT_MARKER, createdIds[0]]);
    }
  });

  it("orders multiple same-pass creates by schedule, not creation order", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const setPositions = vi.fn(async () => undefined);
    const { client, createdIds } = makeDiscordClient(children, setPositions);
    const api = makeApi({
      channels: [],
      signups: [
        // Intentionally non-chronological signup work order.
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "tue-2000-hc-unsaved-lead",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-15T18:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "2026-09-15T18:00:00.000Z"),
        },
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-14T00:00:00.000Z"),
        },
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "thu-1900-hc-unsaved-lead",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-17T17:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "2026-09-17T17:00:00.000Z"),
        },
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "wed-2000-hc-unsaved-lead",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-16T18:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "2026-09-16T18:00:00.000Z"),
        },
      ],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    expect(createdIds).toHaveLength(4);
    const [tue, mon, nextThu, nextWed] = createdIds;
    const order = orderedIds(firstSetPositionsPayload(setPositions));
    expect(order).toEqual([CURRENT_MARKER, mon, tue, NEXT_MARKER, nextWed, nextThu]);
  });

  it("still position-reconciles when signup message send fails after channel create", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const setPositions = vi.fn(async () => undefined);
    const { client, createdIds } = makeDiscordClient(children, setPositions, { sendFails: true });
    const api = makeApi({
      channels: [],
      signups: [
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          existingChannelId: null,
          existingMessageId: null,
          existingRunChannelId: null,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
          embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-14T00:00:00.000Z"),
        },
      ],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    expect(createdIds).toHaveLength(1);
    expect(setPositions).toHaveBeenCalledTimes(1);
    const order = orderedIds(firstSetPositionsPayload(setPositions));
    expect(order).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });

  it("still position-reconciles when roster message work throws", async () => {
    const existingCurrent = "chan-existing-current";
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      // Drifted below #next-id
      [existingCurrent, { id: existingCurrent, name: "mon-0200-hc-unsaved-lead", parentId: CATEGORY_ID, position: 2, type: ChannelType.GuildText }],
    ]);

    const setPositions = vi.fn(async () => undefined);
    const { client } = makeDiscordClient(children, setPositions);
    const api = makeApi({
      channels: [
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
          existingRunChannelId: existingCurrent,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      signups: [],
      roster: [
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
          existingChannelId: existingCurrent,
          existingMessageId: null,
          existingRunChannelId: existingCurrent,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
        },
      ],
      rosterRecordThrows: true,
    });

    await expect(syncOnce(client, botEnv(), api)).rejects.toThrow("roster state boom");

    expect(setPositions).toHaveBeenCalledTimes(1);
    const order = orderedIds(firstSetPositionsPayload(setPositions));
    expect(order).toEqual([CURRENT_MARKER, existingCurrent, NEXT_MARKER]);
  });

  it("does not call setPositions when order is already correct", async () => {
    const existing = "chan-already-correct";
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [existing, { id: existing, name: "mon-0200-hc-unsaved-lead", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 2, type: ChannelType.GuildText }],
    ]);
    const setPositions = vi.fn(async () => undefined);
    const { client } = makeDiscordClient(children, setPositions);
    const api = makeApi({
      channels: [
        {
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
          existingRunChannelId: existing,
          desiredChannelName: "mon-0200-hc-unsaved-lead",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      signups: [],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);
    expect(setPositions).not.toHaveBeenCalled();
  });
});

function firstSetPositionsPayload(
  setPositions: ReturnType<typeof vi.fn>,
): Array<{ channel: string; position: number }> {
  const first = setPositions.mock.calls[0];
  if (!first?.[0]) {
    throw new Error("expected setPositions to have been called");
  }
  return first[0] as Array<{ channel: string; position: number }>;
}

function orderedIds(moves: Array<{ channel: string; position: number }>): string[] {
  return [...moves].sort((a, b) => a.position - b.position).map((move) => move.channel);
}

function makeApi(input: {
  channels: Array<{
    runId: string;
    existingRunChannelId: string;
    desiredChannelName: string;
    targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
    scheduledStartAt: string;
  }>;
  signups: Array<{
    runId: string;
    existingChannelId: string | null;
    existingMessageId: string | null;
    existingRunChannelId: string | null;
    desiredChannelName: string;
    targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
    scheduledStartAt: string;
    embed: unknown;
  }>;
  roster: Array<{
    runId: string;
    existingChannelId: string | null;
    existingMessageId: string | null;
    existingRunChannelId: string | null;
    desiredChannelName: string;
    targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
  }>;
  rosterRecordThrows?: boolean;
}): BotApiClient {
  return {
    listSyncWork: vi.fn().mockResolvedValue({
      channels: input.channels,
      signups: input.signups,
      roster: input.roster,
    }),
    recordDiscordState: vi.fn().mockImplementation(async (_runId: string, payload: { kind: string }) => {
      if (input.rosterRecordThrows && payload.kind === "roster") {
        throw new Error("roster state boom");
      }
    }),
    getRosterEmbedData: vi.fn().mockResolvedValue({
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      runTitle: "Test",
      raidName: "Raid",
      difficulty: "HEROIC",
      publishedAt: "2026-09-13T00:00:00.000Z",
      version: 1,
      targets: { tanks: 2, healers: 4 },
      groups: { tanks: [], healers: [], meleeDps: [], rangedDps: [], lootbuddies: [] },
      totalSelected: 0,
    }),
  } as unknown as BotApiClient;
}

function makeDiscordClient(
  children: Map<string, Child>,
  setPositions: ReturnType<typeof vi.fn>,
  options: { sendFails?: boolean } = {},
) {
  const createdIds: string[] = [];
  let createSeq = 0;

  const channelCache = new Collection<string, unknown>();

  function refreshCache() {
    channelCache.clear();
    for (const child of children.values()) {
      channelCache.set(child.id, toDiscordChannel(child, options.sendFails === true));
    }
    channelCache.set(CATEGORY_ID, toCategoryChannel());
  }

  function toDiscordChannel(child: Child, sendFails: boolean) {
    return {
      id: child.id,
      name: child.name,
      parentId: child.parentId,
      position: child.position,
      type: child.type,
      isTextBased: () => true,
      send: sendFails
        ? vi.fn().mockRejectedValue(new Error("send failed"))
        : vi.fn().mockResolvedValue({ id: `msg-${child.id}`, channelId: child.id }),
      setName: vi.fn().mockResolvedValue(undefined),
      setParent: vi.fn().mockResolvedValue(undefined),
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error("missing")),
      },
    };
  }

  function toCategoryChannel() {
    const childrenCache = new Collection<string, unknown>();
    for (const child of children.values()) {
      childrenCache.set(child.id, toDiscordChannel(child, false));
    }
    return {
      id: CATEGORY_ID,
      type: ChannelType.GuildCategory,
      children: { cache: childrenCache },
      guild: {
        channels: {
          create: async ({ name, parent }: { name: string; parent: string }) => {
            createSeq += 1;
            const id = `created-${createSeq}`;
            createdIds.push(id);
            const maxPos = [...children.values()].reduce((max, c) => Math.max(max, c.position), -1);
            const child: Child = {
              id,
              name,
              parentId: parent,
              position: maxPos + 1,
              type: ChannelType.GuildText,
            };
            children.set(id, child);
            refreshCache();
            return toDiscordChannel(child, options.sendFails === true);
          },
          setPositions,
        },
      },
    };
  }

  refreshCache();

  const client = {
    channels: {
      cache: channelCache,
      fetch: vi.fn(async (id: string) => {
        refreshCache();
        return channelCache.get(id) ?? null;
      }),
    },
    guilds: {
      fetch: vi.fn(async () => ({
        channels: {
          setPositions,
        },
      })),
    },
  };

  return { client: client as never, createdIds };
}
