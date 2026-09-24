import { ChannelType, Collection } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";

const GUILD_ID = "guild-1";
const TEXT_CATEGORY_ID = "cat-weekly";
const VOICE_CATEGORY_ID = "cat-voice";
const RUN_ID = "run-voice-1";

function botEnv(overrides: Partial<BotEnv> = {}): BotEnv {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordGuildId: GUILD_ID,
    discordRunCategoryId: TEXT_CATEGORY_ID,
    discordRunCurrentMarkerChannelId: null,
    discordRunNextMarkerChannelId: null,
    discordRunArchiveCategoryId: null,
    discordRunArchiveLogChannelId: null,
    discordRunVoiceCategoryId: VOICE_CATEGORY_ID,
    discordPingRoleTankId: null,
    discordPingRoleHealerId: null,
    discordPingRoleDpsId: null,
    discordSignupChannelId: null,
    discordRosterChannelId: null,
    apiBaseUrl: "http://localhost",
    botApiToken: "bot-token",
    syncIntervalMs: 60_000,
    ...overrides,
  };
}

type VoiceItem = {
  runId: string;
  existingVoiceChannelId: string | null;
  desiredVoiceChannelName: string;
  action: "PROVISION" | "RECONCILE" | "RETIRE_IF_EMPTY";
};

function makeApi(voiceChannels: VoiceItem[], notificationDms: Array<Record<string, unknown>> = []): BotApiClient {
  return {
    listSyncWork: vi.fn().mockResolvedValue({
      channels: [],
      voiceChannels,
      signups: [],
      roster: [],
      start: [],
      raidInvites: [],
      notificationDms,
      runAnnouncements: [],
    }),
    recordDiscordState: vi.fn().mockResolvedValue(undefined),
    getRosterEmbedData: vi.fn().mockResolvedValue(null),
    getRunStartEmbedData: vi.fn().mockResolvedValue(null),
  } as unknown as BotApiClient;
}

/**
 * Minimal Discord mock: a voice category whose guild can create channels,
 * existing voice channels with a member count, and DM-able users.
 */
function makeClient(options: {
  voiceCategoryType?: ChannelType;
  createFails?: unknown;
  existingVoice?: Record<string, number>;
  nextVoiceId?: string;
} = {}) {
  const create = vi.fn(async (input: { name: string; type: ChannelType; parent: string }) => {
    if (options.createFails) throw options.createFails;
    const id = options.nextVoiceId ?? "222";
    channels.set(id, voiceChannel(id, input.name, 0));
    return { id };
  });
  const dmSend = vi.fn().mockResolvedValue(undefined);

  function voiceChannel(id: string, name: string, members: number) {
    return {
      id,
      name,
      type: ChannelType.GuildVoice,
      members: { size: members },
      setName: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
  }

  const channels = new Map<string, unknown>();
  channels.set(VOICE_CATEGORY_ID, {
    id: VOICE_CATEGORY_ID,
    type: options.voiceCategoryType ?? ChannelType.GuildCategory,
    guild: { channels: { create } },
  });
  for (const [id, members] of Object.entries(options.existingVoice ?? {})) {
    channels.set(id, voiceChannel(id, "Raid with Syntax", members));
  }

  const fetchChannel = vi.fn(async (id: string) => {
    const channel = channels.get(id);
    if (!channel) throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
    return channel;
  });

  const client = {
    channels: { cache: new Collection(), fetch: fetchChannel },
    users: { fetch: vi.fn(async () => ({ send: dmSend })) },
    guilds: {
      fetch: vi.fn(async () => ({
        emojis: { fetch: vi.fn().mockResolvedValue(undefined), cache: { values: () => [][Symbol.iterator]() } },
        roles: { fetch: vi.fn().mockResolvedValue(new Collection()), cache: new Collection() },
        channels: { cache: new Collection(), setPositions: vi.fn(), fetch: vi.fn().mockResolvedValue(new Collection()) },
      })),
    },
  };
  return { client: client as never, create, fetchChannel, dmSend, channels };
}

const provision: VoiceItem = { runId: RUN_ID, existingVoiceChannelId: null, desiredVoiceChannelName: "Raid with Syntax", action: "PROVISION" };

describe("syncOnce — temporary Run voice channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates exactly one GuildVoice channel in DISCORD_RUN_VOICE_CATEGORY_ID named `Raid with <Raid Lead>` and records it", async () => {
    const { client, create } = makeClient();
    const api = makeApi([provision]);

    await syncOnce(client, botEnv(), api);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ name: "Raid with Syntax", type: ChannelType.GuildVoice, parent: VOICE_CATEGORY_ID });
    expect(api.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "voice-channel", channelId: "222" });
  });

  it("second poll (RECONCILE of the recorded channel) creates no duplicate", async () => {
    const { client, create } = makeClient({ existingVoice: { "222": 0 } });
    const api = makeApi([{ ...provision, existingVoiceChannelId: "222", action: "RECONCILE" }]);

    await syncOnce(client, botEnv(), api);

    expect(create).not.toHaveBeenCalled();
    expect(api.recordDiscordState).not.toHaveBeenCalled();
  });

  it("DISCORD_RUN_VOICE_CATEGORY_ID unset: voice feature disabled, nothing fetched or created", async () => {
    const { client, create, fetchChannel } = makeClient();
    const api = makeApi([provision]);

    await syncOnce(client, botEnv({ discordRunVoiceCategoryId: null }), api);

    expect(create).not.toHaveBeenCalled();
    expect(fetchChannel).not.toHaveBeenCalledWith(VOICE_CATEGORY_ID);
    expect(api.recordDiscordState).not.toHaveBeenCalled();
  });

  it("configured id that is not a GuildCategory: logs, creates nothing, no fallback, sync continues", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, create } = makeClient({ voiceCategoryType: ChannelType.GuildText });
    const api = makeApi([provision]);

    await expect(syncOnce(client, botEnv(), api)).resolves.toBeUndefined();

    expect(create).not.toHaveBeenCalled();
    expect(api.recordDiscordState).not.toHaveBeenCalled();
    expect(error.mock.calls.some((call) => String(call[0]).includes("DISCORD_RUN_VOICE_CATEGORY_ID"))).toBe(true);
    error.mockRestore();
  });

  it("Missing Permissions on create: nothing recorded, sync continues (retry next poll)", async () => {
    const { client, create } = makeClient({ createFails: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
    const api = makeApi([provision]);

    await expect(syncOnce(client, botEnv(), api)).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    expect(api.recordDiscordState).not.toHaveBeenCalled();
  });

  function raidInviteDm(runId: string, voiceChannelId: string | null) {
    return {
      notificationId: `aaaaaaaa-aaaa-4aaa-8aaa-${runId.slice(-12).padStart(12, "0")}`,
      type: "RAID_INVITE",
      discordUserId: "discord-user-1",
      runId,
      signupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      runChannelId: "111",
      voiceChannelId,
      productLabel: "Season 2 Bundle",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      previousScheduledStartAt: null,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      participationType: "BOOSTER",
      selectedRole: "HEALER",
      characterName: "Synlight",
      wowClass: "PRIEST",
    };
  }

  it("SAME PASS: a voice channel created this pass is linked in that pass's Raid Invite (projection had null)", async () => {
    const { client, dmSend } = makeClient({ nextVoiceId: "222" });
    const api = makeApi([provision], [raidInviteDm(RUN_ID, null)]);

    await syncOnce(client, botEnv(), api);

    expect(dmSend).toHaveBeenCalledTimes(1);
    const content = (dmSend.mock.calls[0]![0] as { content: string }).content;
    expect(content).toContain("Channel: <#111>");
    expect(content).toContain("Voice: <#222>");
    expect(api.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "voice-channel", channelId: "222" });
  });

  it("SAME PASS: a voice channel deleted this pass is never linked, even if the projection still had its id", async () => {
    const { client, dmSend } = makeClient({ existingVoice: { "333": 0 } });
    const api = makeApi(
      [{ ...provision, existingVoiceChannelId: "333", action: "RETIRE_IF_EMPTY" }],
      [raidInviteDm(RUN_ID, "333")],
    );

    await syncOnce(client, botEnv(), api);

    const content = (dmSend.mock.calls[0]![0] as { content: string }).content;
    expect(content).not.toContain("Voice:");
    expect(content).not.toContain("<#333>");
  });

  it("a Run untouched by this pass's voice lane uses the delivery-time persisted id", async () => {
    const { client, dmSend } = makeClient();
    const api = makeApi([], [raidInviteDm("run-voice-other", "444")]);

    await syncOnce(client, botEnv(), api);

    expect((dmSend.mock.calls[0]![0] as { content: string }).content).toContain("Voice: <#444>");
  });

  it("terminal Run: occupied channel kept; empty channel deleted and cleared", async () => {
    const occupied = makeClient({ existingVoice: { "333": 2 } });
    const occupiedApi = makeApi([{ ...provision, existingVoiceChannelId: "333", action: "RETIRE_IF_EMPTY" }]);
    await syncOnce(occupied.client, botEnv(), occupiedApi);
    expect((occupied.channels.get("333") as { delete: ReturnType<typeof vi.fn> }).delete).not.toHaveBeenCalled();
    expect(occupiedApi.recordDiscordState).not.toHaveBeenCalled();

    const empty = makeClient({ existingVoice: { "333": 0 } });
    const emptyApi = makeApi([{ ...provision, existingVoiceChannelId: "333", action: "RETIRE_IF_EMPTY" }]);
    await syncOnce(empty.client, botEnv(), emptyApi);
    expect((empty.channels.get("333") as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledTimes(1);
    expect(emptyApi.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "clear-voice-channel", channelId: "333" });
  });
});
