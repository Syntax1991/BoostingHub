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
  it("A: first CURRENT channel lands between markers in the SAME pass", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, serverOrder } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            // Tuesday 15 Sep 2026 18:00 Europe/Berlin
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions).toHaveBeenCalled();
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });

  it("B: retries same-pass when fresh Discord order stays wrong after first setPositions", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, serverOrder, cacheOrder } = makeDiscordClient(children, {
      // Cache updates immediately; fresh/server only on 2nd write — live Discord lag.
      freshAppliesAfterSetPositionsCalls: 2,
    });

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Cache alone can look correct after first write — must not hide server lag.
    expect(cacheOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });

  it("C: bounded failure — stops after max attempts when fresh never converges", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, setPositions } = makeDiscordClient(children, {
      freshAppliesAfterSetPositionsCalls: Number.POSITIVE_INFINITY,
    });

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(setPositions).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("D: brand-new NEXT channel stays below #next-id in the SAME pass", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, serverOrder } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "sat-1800-hc-unsaved-lead",
            targetBucket: "NEXT",
            scheduledStartAt: "2026-09-19T16:00:00.000Z",
            embed: signupEmbed("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-09-19T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(serverOrder()).toEqual([CURRENT_MARKER, NEXT_MARKER, createdIds[0]]);
  });

  it("E: existing + newly created CURRENT stay chronological", async () => {
    const existing = "chan-tue-1500";
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [existing, { id: existing, name: "tue-1500-hc-unsaved-lead", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 2, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, serverOrder } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
            existingRunChannelId: existing,
            desiredChannelName: "tue-1500-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T13:00:00.000Z",
          },
        ],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions).toHaveBeenCalled();
    expect(serverOrder()).toEqual([CURRENT_MARKER, existing, createdIds[0], NEXT_MARKER]);
  });

  it("F: multiple newly created CURRENT channels order chronologically", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, serverOrder } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "2026-09-15T16:00:00.000Z"),
          },
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1500-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T13:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T13:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(2);
    expect(setPositions).toHaveBeenCalled();
    // created-1 is tue-1800 (first signup), created-2 is tue-1500 (second) — order by schedule.
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[1], createdIds[0], NEXT_MARKER]);
  });

  it("G: signup message send failure still converges positioning", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, serverOrder } = makeDiscordClient(children, { sendFails: true });

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions).toHaveBeenCalled();
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });

  it("H: already correct order — no unnecessary setPositions", async () => {
    const existing = "chan-already-correct";
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [existing, { id: existing, name: "mon-0200-hc-unsaved-lead", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 2, type: ChannelType.GuildText }],
    ]);
    const { client, setPositions } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
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
      }),
    );

    expect(setPositions).not.toHaveBeenCalled();
  });

  it("I: ARCHIVE target does not provision or position into CURRENT/NEXT", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "old-run",
            targetBucket: "ARCHIVE",
            scheduledStartAt: "2026-08-01T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", "2026-08-01T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    // Signup path still may create if API returned the item — but section item is null for ARCHIVE.
    // If a channel was created it must not force a CURRENT/NEXT reorder solely for ARCHIVE.
    if (createdIds.length > 0) {
      expect(setPositions).not.toHaveBeenCalled();
    }
  });

  it("J: cache view alone cannot hide a wrong fresh server order", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds, setPositions, cacheOrder, serverOrder } = makeDiscordClient(children, {
      freshAppliesAfterSetPositionsCalls: 2,
    });

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: null,
            existingMessageId: null,
            existingRunChannelId: null,
            desiredChannelName: "tue-1800-hc-unsaved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions.mock.calls.length).toBe(2);
    // After settle, both views match — proving we did not stop on cache alone.
    expect(cacheOrder()).toEqual(serverOrder());
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });
});

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
}): BotApiClient {
  return {
    listSyncWork: vi.fn().mockResolvedValue({
      channels: input.channels,
      signups: input.signups,
      roster: input.roster,
    }),
    recordDiscordState: vi.fn().mockResolvedValue(undefined),
    getRosterEmbedData: vi.fn().mockResolvedValue(null),
  } as unknown as BotApiClient;
}

/**
 * Dual-view Discord mock: `cache` is what create/category.children see;
 * `server` is what `guild.channels.fetch()` returns for fresh verification.
 * They start in sync on create; `freshAppliesAfterSetPositionsCalls` delays
 * server updates so tests can prove we do not trust cache alone.
 */
function makeDiscordClient(
  children: Map<string, Child>,
  options: {
    sendFails?: boolean;
    freshAppliesAfterSetPositionsCalls?: number;
  } = {},
) {
  const createdIds: string[] = [];
  let createSeq = 0;
  let setPositionsCalls = 0;
  const freshAfter = options.freshAppliesAfterSetPositionsCalls ?? 1;

  // Deep-cloneable state: cache vs server.
  const cacheChildren = children;
  const serverChildren = new Map<string, Child>();
  for (const [id, child] of children) {
    serverChildren.set(id, { ...child });
  }

  const channelCache = new Collection<string, unknown>();

  function applyMoves(target: Map<string, Child>, moves: Array<{ channel: string; position: number }>) {
    for (const move of moves) {
      const child = target.get(move.channel);
      if (child) child.position = move.position;
    }
  }

  const setPositions = vi.fn(async (moves: Array<{ channel: string; position: number }>) => {
    setPositionsCalls += 1;
    applyMoves(cacheChildren, moves);
    if (setPositionsCalls >= freshAfter) {
      applyMoves(serverChildren, moves);
    }
    refreshCache();
  });

  function refreshCache() {
    channelCache.clear();
    for (const child of cacheChildren.values()) {
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

  function categoryChildrenCacheFrom(source: Map<string, Child>) {
    const childrenCache = new Collection<string, unknown>();
    for (const child of source.values()) {
      childrenCache.set(child.id, toDiscordChannel(child, false));
    }
    return childrenCache;
  }

  function toCategoryChannel() {
    return {
      id: CATEGORY_ID,
      type: ChannelType.GuildCategory,
      children: { cache: categoryChildrenCacheFrom(cacheChildren) },
      guild: {
        channels: {
          create: async ({ name, parent }: { name: string; parent: string }) => {
            createSeq += 1;
            const id = `created-${createSeq}`;
            createdIds.push(id);
            const maxPos = [...cacheChildren.values()].reduce((max, c) => Math.max(max, c.position), -1);
            const child: Child = {
              id,
              name,
              parentId: parent,
              position: maxPos + 1,
              type: ChannelType.GuildText,
            };
            cacheChildren.set(id, child);
            serverChildren.set(id, { ...child });
            refreshCache();
            return toDiscordChannel(child, options.sendFails === true);
          },
          setPositions,
          fetch: async () => {
            // Fresh REST: rebuild guild channel cache from serverChildren.
            const fresh = new Collection<string, unknown>();
            for (const child of serverChildren.values()) {
              fresh.set(child.id, toDiscordChannel(child, false));
            }
            fresh.set(CATEGORY_ID, {
              id: CATEGORY_ID,
              type: ChannelType.GuildCategory,
              children: { cache: categoryChildrenCacheFrom(serverChildren) },
              parentId: null,
            });
            guildChannelCache.clear();
            for (const [id, value] of fresh) {
              guildChannelCache.set(id, value);
            }
            return fresh;
          },
        },
      },
    };
  }

  const guildChannelCache = new Collection<string, unknown>();

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
          cache: guildChannelCache,
          setPositions,
          fetch: async () => {
            const fresh = new Collection<string, unknown>();
            for (const child of serverChildren.values()) {
              fresh.set(child.id, toDiscordChannel(child, false));
            }
            fresh.set(CATEGORY_ID, {
              id: CATEGORY_ID,
              type: ChannelType.GuildCategory,
              children: { cache: categoryChildrenCacheFrom(serverChildren) },
              parentId: null,
            });
            guildChannelCache.clear();
            for (const [id, value] of fresh) {
              guildChannelCache.set(id, value);
            }
            return fresh;
          },
        },
      })),
    },
  };

  const ordered = (source: Map<string, Child>) =>
    [...source.values()].sort((a, b) => a.position - b.position).map((c) => c.id);

  return {
    client: client as never,
    createdIds,
    setPositions,
    cacheOrder: () => ordered(cacheChildren),
    serverOrder: () => ordered(serverChildren),
  };
}
