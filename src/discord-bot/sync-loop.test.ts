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
    discordRunArchiveLogChannelId: "archive-log-chan",
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

function signupEmbed(runId: string, scheduledStartAt: string) {
  return {
    runId,
    runTitle: "Test Run",
    raidName: "The Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    titleCoverage: "8/8",
    raidLeadName: "Titan",
    raidLeadDiscordUserId: null,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt,
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
  };
}

describe("syncOnce — raidboost announce on first channel create", () => {
  it("posts Phoenix announce + role pings once when the Run channel is created", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
    ]);
    const { client, createdIds } = makeDiscordClient(children);

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
            desiredChannelName: "tue-1800-hc-saved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: {
              ...signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
              difficulty: "HEROIC",
              lootType: "SAVED",
            },
          },
        ],
        roster: [],
        start: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    const createdChannel = client.channels.cache.get(createdIds[0]!) as { send: ReturnType<typeof vi.fn> };
    // Announce first, then signup embed.
    expect(createdChannel.send).toHaveBeenCalledTimes(2);
    const announce = createdChannel.send.mock.calls[0][0] as {
      content: string;
      embeds: Array<{ data?: { title?: string; description?: string }; toJSON?: () => { title?: string; description?: string } }>;
      allowedMentions: { roles: string[]; parse?: string[]; users?: string[]; repliedUser?: boolean };
    };
    expect(announce.content).toBe("<@&role-tank> <@&role-healer> <@&role-dps>");
    expect(announce.allowedMentions.roles).toEqual(["role-tank", "role-healer", "role-dps"]);
    expect(announce.allowedMentions.parse).toEqual([]);
    const embedJson =
      typeof announce.embeds[0]?.toJSON === "function"
        ? announce.embeds[0].toJSON()
        : (announce.embeds[0] as { data?: { title?: string; description?: string } }).data;
    expect(embedJson?.title).toContain("PhoenixStarDiscord");
    expect(embedJson?.title).toContain("Raidboost Announce");
    expect(embedJson?.description).toContain("**HC** 💰❌ Heroic Saved");
  });

  it("does not re-announce when the Run channel already exists", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      ["existing-chan", { id: "existing-chan", name: "tue-1800-hc-saved-lead", parentId: CATEGORY_ID, position: 2, type: ChannelType.GuildText }],
    ]);
    const { client } = makeDiscordClient(children);

    await syncOnce(
      client,
      botEnv(),
      makeApi({
        channels: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingRunChannelId: "existing-chan",
            desiredChannelName: "tue-1800-hc-saved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
          },
        ],
        signups: [
          {
            runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            existingChannelId: "existing-chan",
            existingMessageId: null,
            existingRunChannelId: "existing-chan",
            desiredChannelName: "tue-1800-hc-saved-lead",
            targetBucket: "CURRENT",
            scheduledStartAt: "2026-09-15T16:00:00.000Z",
            embed: signupEmbed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "2026-09-15T16:00:00.000Z"),
          },
        ],
        roster: [],
        start: [],
      }),
    );

    const existing = client.channels.cache.get("existing-chan") as { send: ReturnType<typeof vi.fn> };
    // Only the signup embed — no role-ping announce.
    expect(existing.send).toHaveBeenCalledTimes(1);
    const only = existing.send.mock.calls[0][0] as { content?: string; embeds: unknown[]; components?: unknown[] };
    expect(only.components).toBeDefined();
    expect(only.content).toBeUndefined();
  });
});

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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
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
        start: [],
      }),
    );

    expect(createdIds).toHaveLength(1);
    expect(setPositions.mock.calls.length).toBe(2);
    // After settle, both views match — proving we did not stop on cache alone.
    expect(cacheOrder()).toEqual(serverOrder());
    expect(serverOrder()).toEqual([CURRENT_MARKER, createdIds[0], NEXT_MARKER]);
  });
});

describe("syncOnce — app-archive transcript artifacts", () => {
  it("posts Server-Info+HTML and details embed to the archive log channel once", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      ["archive-chan", { id: "archive-chan", name: "old-name", parentId: "archive-cat", position: 2, type: ChannelType.GuildText }],
      ["archive-log-chan", { id: "archive-log-chan", name: "raid-open-channel-logs", parentId: "logs-cat", position: 3, type: ChannelType.GuildText }],
    ]);
    const { client } = makeDiscordClient(children);
    const api = makeApi({
      channels: [
        {
          runId: "run-archived",
          existingRunChannelId: "archive-chan",
          desiredChannelName: "closed-sat-2200-hc-vip-7of9-titan",
          targetBucket: "ARCHIVE",
          scheduledStartAt: "2026-09-12T20:00:00.000Z",
          appArchived: true,
          archiveArtifactsNeeded: true,
          raidLeadName: "Titan",
          raidLeadDiscordUserId: "lead-1",
          panelName: "The Venomous Abyss",
        },
      ],
      signups: [],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    const logChannel = client.channels.cache.get("archive-log-chan") as { send: ReturnType<typeof vi.fn> };
    expect(logChannel.send).toHaveBeenCalledTimes(2);
    const first = logChannel.send.mock.calls[0][0] as { content: string; files: Array<{ name: string }> };
    expect(first.content).toContain("<Server-Info>");
    expect(first.content).toContain("closed-sat-2200-hc-vip-7of9-titan");
    expect(first.files[0]?.name).toBe("transcript-closed-sat-2200-hc-vip-7of9-titan.html");
    const second = logChannel.send.mock.calls[1][0] as { embeds: unknown[]; components: unknown[] };
    expect(second.embeds).toHaveLength(1);
    expect(second.components).toHaveLength(1);
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-archived", {
      kind: "archive-artifacts",
      closeMessageId: "msg-archive-log-chan-2",
      transcriptMessageId: "msg-archive-log-chan-1",
      transcriptHtml: expect.stringContaining("<Server-Info>"),
      transcriptFilename: "transcript-closed-sat-2200-hc-vip-7of9-titan.html",
    });
    const archivedChannel = client.channels.cache.get("archive-chan") as { delete: ReturnType<typeof vi.fn>; setParent: ReturnType<typeof vi.fn> };
    expect(archivedChannel.setParent).not.toHaveBeenCalled();
    expect(archivedChannel.delete).toHaveBeenCalledTimes(1);
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-archived", { kind: "clear-channel" });
  });

  it("persists HTML without re-posting when Discord archive message ids already exist", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      ["archive-chan", { id: "archive-chan", name: "closed-sat-2200-hc-vip-7of9-titan", parentId: "archive-cat", position: 2, type: ChannelType.GuildText }],
      ["archive-log-chan", { id: "archive-log-chan", name: "raid-open-channel-logs", parentId: "logs-cat", position: 3, type: ChannelType.GuildText }],
    ]);
    const { client } = makeDiscordClient(children);
    const api = makeApi({
      channels: [
        {
          runId: "run-html-backfill",
          existingRunChannelId: "archive-chan",
          desiredChannelName: "closed-sat-2200-hc-vip-7of9-titan",
          targetBucket: "ARCHIVE",
          scheduledStartAt: "2026-09-12T20:00:00.000Z",
          appArchived: true,
          archiveArtifactsNeeded: true,
          archiveCloseMessageId: "existing-close",
          archiveTranscriptMessageId: "existing-transcript",
          raidLeadName: "Titan",
          raidLeadDiscordUserId: "lead-1",
          panelName: "The Venomous Abyss",
        },
      ],
      signups: [],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    const logChannel = client.channels.cache.get("archive-log-chan") as { send: ReturnType<typeof vi.fn> };
    expect(logChannel.send).not.toHaveBeenCalled();
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-html-backfill", {
      kind: "archive-artifacts",
      closeMessageId: "existing-close",
      transcriptMessageId: "existing-transcript",
      transcriptHtml: expect.stringContaining("<Server-Info>"),
      transcriptFilename: "transcript-closed-sat-2200-hc-vip-7of9-titan.html",
    });
    const archivedChannel = client.channels.cache.get("archive-chan") as { delete: ReturnType<typeof vi.fn> };
    expect(archivedChannel.delete).toHaveBeenCalledTimes(1);
    expect(api.recordDiscordState).toHaveBeenCalledWith("run-html-backfill", { kind: "clear-channel" });
  });

  it("does not post archive artifacts for schedule-based ARCHIVE holding", async () => {
    const children = new Map<string, Child>([
      [CURRENT_MARKER, { id: CURRENT_MARKER, name: "current-id", parentId: CATEGORY_ID, position: 0, type: ChannelType.GuildText }],
      [NEXT_MARKER, { id: NEXT_MARKER, name: "next-id", parentId: CATEGORY_ID, position: 1, type: ChannelType.GuildText }],
      ["hold-chan", { id: "hold-chan", name: "sat-2200-hc-vip-7of9-titan", parentId: "archive-cat", position: 2, type: ChannelType.GuildText }],
      ["archive-log-chan", { id: "archive-log-chan", name: "raid-open-channel-logs", parentId: "logs-cat", position: 3, type: ChannelType.GuildText }],
    ]);
    const { client } = makeDiscordClient(children);
    const api = makeApi({
      channels: [
        {
          runId: "run-holding",
          existingRunChannelId: "hold-chan",
          desiredChannelName: "sat-2200-hc-vip-7of9-titan",
          targetBucket: "ARCHIVE",
          scheduledStartAt: "2026-08-01T20:00:00.000Z",
          appArchived: false,
          archiveArtifactsNeeded: false,
          raidLeadName: "Titan",
          raidLeadDiscordUserId: null,
          panelName: "Raid",
        },
      ],
      signups: [],
      roster: [],
    });

    await syncOnce(client, botEnv(), api);

    const logChannel = client.channels.cache.get("archive-log-chan") as { send: ReturnType<typeof vi.fn> };
    expect(logChannel.send).not.toHaveBeenCalled();
    expect(api.recordDiscordState).not.toHaveBeenCalled();
  });
});

function makeApi(input: {
  channels: Array<{
    runId: string;
    existingRunChannelId: string;
    desiredChannelName: string;
    targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
    scheduledStartAt: string;
    appArchived?: boolean;
    archiveArtifactsNeeded?: boolean;
    archiveCloseMessageId?: string | null;
    archiveTranscriptMessageId?: string | null;
    raidLeadName?: string;
    raidLeadDiscordUserId?: string | null;
    panelName?: string;
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
  start?: Array<{
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
      channels: input.channels.map((channel) => ({
        appArchived: false,
        archiveArtifactsNeeded: false,
        archiveCloseMessageId: null,
        archiveTranscriptMessageId: null,
        raidLeadName: "Lead",
        raidLeadDiscordUserId: null,
        panelName: "Raid",
        ...channel,
      })),
      signups: input.signups,
      roster: input.roster,
      start: input.start ?? [],
    }),
    recordDiscordState: vi.fn().mockResolvedValue(undefined),
    getRosterEmbedData: vi.fn().mockResolvedValue(null),
    getRunStartEmbedData: vi.fn().mockResolvedValue(null),
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
  /** Stable per-channel spies so refreshCache does not erase call history under assertion. */
  const sendSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const setNameSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const setParentSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const deleteSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const messagesFetchSpies = new Map<string, ReturnType<typeof vi.fn>>();

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
    if (!sendSpies.has(child.id)) {
      if (sendFails) {
        sendSpies.set(child.id, vi.fn().mockRejectedValue(new Error("send failed")));
      } else {
        let seq = 0;
        sendSpies.set(
          child.id,
          vi.fn().mockImplementation(async (payload?: { files?: Array<{ name?: string }> }) => {
            seq += 1;
            const attachments = new Collection<string, { url: string; name: string }>();
            const fileName = payload?.files?.[0]?.name ?? "file.bin";
            if (payload?.files?.length) {
              attachments.set("att-1", {
                url: `https://cdn.example/${fileName}`,
                name: fileName,
              });
            }
            return {
              id: `msg-${child.id}-${seq}`,
              channelId: child.id,
              attachments,
            };
          }),
        );
      }
    }
    if (!setNameSpies.has(child.id)) {
      setNameSpies.set(child.id, vi.fn().mockResolvedValue(undefined));
    }
    if (!setParentSpies.has(child.id)) {
      setParentSpies.set(child.id, vi.fn().mockResolvedValue(undefined));
    }
    if (!deleteSpies.has(child.id)) {
      deleteSpies.set(child.id, vi.fn().mockResolvedValue(undefined));
    }
    if (!messagesFetchSpies.has(child.id)) {
      const history = new Collection<string, {
        id: string;
        createdTimestamp: number;
        author: { id: string; username: string; displayName: string; discriminator?: string };
        content: string;
        embeds: Array<{ title?: string | null; description?: string | null }>;
      }>();
      history.set("hist-1", {
        id: "hist-1",
        createdTimestamp: Date.parse("2026-09-12T18:00:00.000Z"),
        author: { id: "u1", username: "titan", displayName: "Titan", discriminator: "0" },
        content: "hello archive",
        embeds: [],
      });
      messagesFetchSpies.set(
        child.id,
        vi.fn().mockImplementation(async (arg?: string | { limit?: number; before?: string }) => {
          if (typeof arg === "string") {
            throw new Error("missing");
          }
          return history;
        }),
      );
    }
    return {
      id: child.id,
      name: child.name,
      parentId: child.parentId,
      position: child.position,
      type: child.type,
      isTextBased: () => true,
      send: sendSpies.get(child.id)!,
      setName: setNameSpies.get(child.id)!,
      setParent: setParentSpies.get(child.id)!,
      delete: deleteSpies.get(child.id)!,
      messages: {
        fetch: messagesFetchSpies.get(child.id)!,
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
        id: GUILD_ID,
        name: "Phoenix Star",
        emojis: {
          fetch: vi.fn(async () => undefined),
          cache: new Collection([
            [
              "emoji-phoenix",
              {
                id: "emoji-phoenix",
                name: "PhoenixStarDiscord",
                toString: () => "<:PhoenixStarDiscord:emoji-phoenix>",
              },
            ],
          ]),
        },
        roles: {
          fetch: vi.fn(async () => {
            return new Collection([
              ["role-tank", { id: "role-tank", name: "tank", mentionable: true }],
              ["role-healer", { id: "role-healer", name: "healer", mentionable: true }],
              ["role-dps", { id: "role-dps", name: "dps", mentionable: true }],
            ]);
          }),
          cache: new Collection([
            ["role-tank", { id: "role-tank", name: "tank", mentionable: true }],
            ["role-healer", { id: "role-healer", name: "healer", mentionable: true }],
            ["role-dps", { id: "role-dps", name: "dps", mentionable: true }],
          ]),
        },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Discord.js Client mock for syncOnce + channel spy assertions
    client: client as any,
    createdIds,
    setPositions,
    cacheOrder: () => ordered(cacheChildren),
    serverOrder: () => ordered(serverChildren),
  };
}
