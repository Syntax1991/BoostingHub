import { ChannelType, Collection } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { syncOnce } from "@/discord-bot/sync-loop";
import { formatFinalSetupLfgLine } from "@/lib/run-start-message";
import { finalSetupAllowedMentions, renderRunStartMessageText } from "@/discord-bot/messages/run-start-message";
import { buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";

const CATEGORY_ID = "cat-weekly";
const GUILD_ID = "guild-1";
const CHANNEL_ID = "run-chan-1";
const CURRENT_MARKER = "marker-current";
const NEXT_MARKER = "marker-next";
const VOICE_CATEGORY_ID = "cat-voice";

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
      voiceChannelId: null,
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
      voiceChannelId: null,
    });
  });
});

describe("syncOnce — Final Setup explicit allowedMentions", () => {
  function member(signupId: string, discordUserId: string | null, userName: string, participationType: "BOOSTER" | "LOOTBUDDY", selectedRole: "TANK" | "HEALER" | "DPS" | null) {
    return {
      signupId,
      userId: `u-${signupId}`,
      userName,
      discordUserId,
      characterName: userName,
      characterRealm: "Draenor",
      wowClass: "SHAMAN" as const,
      classLabel: "Shaman",
      saveLabel: "Unsaved",
      participationType,
      selectedRole,
    };
  }

  // Duplicate Discord ids (same user on two rows) and no-id rows whose fallback
  // text would read "@everyone" / "@here"; hostile Raid Lead display name.
  const mentionData = {
    ...startData,
    raidLeadDisplayName: "@everyone Syntax\n**pwned**",
    groups: {
      tanks: [member("t1", "111", "Dusk", "BOOSTER", "TANK")],
      healers: [member("h1", "222", "Mend", "BOOSTER", "HEALER"), member("h2", null, "everyone", "BOOSTER", "HEALER")],
      dps: [member("d1", "333", "Blade", "BOOSTER", "DPS"), member("d2", "111", "DuskAlt", "BOOSTER", "DPS")],
      lootbuddies: [member("l1", null, "here", "LOOTBUDDY", null), member("l2", "222", "Mend", "LOOTBUDDY", null)],
    },
    totalSelected: 7,
  };
  const expectedPolicy = { parse: [], users: ["111", "222", "333"], roles: [], repliedUser: false };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("send: only unique, non-null selected roster Discord ids may be mentioned; no @everyone/@here/role parsing", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const { client } = makeStartClient({ send, edit: vi.fn() });

    await syncOnce(client, botEnv(), makeStartApi({ existingMessageId: null, data: mentionData }));

    const payload = send.mock.calls[0]![0] as { content: string; allowedMentions?: unknown };
    expect(payload.allowedMentions).toEqual(expectedPolicy);
    expect(finalSetupAllowedMentions(mentionData)).toEqual(expectedPolicy);
    // The informational fallback text stays, but parse: [] keeps it inert.
    expect(payload.content).toContain("@everyone");
    expect(payload.content).toContain("@here");
    // The hostile Raid Lead name stays on one footer line without a raw @everyone.
    const footer = payload.content.slice(payload.content.lastIndexOf("\n") + 1);
    expect(footer.startsWith("**LFG HM @")).toBe(true);
    expect(footer).not.toMatch(/@everyone/);
    expect(footer).toContain("\\*\\*pwned\\*\\*");
    expect(payload.content.match(/LFG HM/g)).toHaveLength(1);
  });

  it("edit: the existing Final Setup message receives the same allowedMentions policy", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const edit = vi.fn().mockResolvedValue(undefined);
    const { client: sendClient } = makeStartClient({ send, edit: vi.fn() });
    await syncOnce(sendClient, botEnv(), makeStartApi({ existingMessageId: null, data: mentionData }));
    const sendPolicy = (send.mock.calls[0]![0] as { allowedMentions?: unknown }).allowedMentions;

    const { client } = makeStartClient({ send: vi.fn(), edit, existingMessageId: "msg-old" });
    await syncOnce(client, botEnv(), makeStartApi({ existingMessageId: "msg-old", data: mentionData }));

    const payload = edit.mock.calls[0]![0] as { allowedMentions?: unknown; embeds?: unknown[] };
    expect(payload.allowedMentions).toEqual(expectedPolicy);
    expect(payload.allowedMentions).toEqual(sendPolicy);
    expect(payload.embeds).toEqual([]);
  });

  it("a roster with no Discord ids permits no user mentions at all", () => {
    const policy = finalSetupAllowedMentions({
      groups: { tanks: [member("t1", null, "everyone", "BOOSTER", "TANK")], healers: [], dps: [], lootbuddies: [member("l1", null, "here", "LOOTBUDDY", null)] },
    });
    expect(policy).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
  });
});

describe("syncOnce — Final Setup links the Run's temporary Voice channel", () => {
  const RUN_ID = "run-start-1";
  const voiceEnv = (): BotEnv => ({ ...botEnv(), discordRunVoiceCategoryId: VOICE_CATEGORY_ID });
  const voiceItem = (action: StartVoiceItem["action"], existingVoiceChannelId: string | null): StartVoiceItem => ({
    runId: RUN_ID,
    existingVoiceChannelId,
    desiredVoiceChannelName: "Raid with Syntax",
    action,
  });
  const contentOf = (mock: ReturnType<typeof vi.fn>) => (mock.mock.calls[0]![0] as { content: string }).content;
  const startRecords = (api: BotApiClient) =>
    vi.mocked(api.recordDiscordState).mock.calls.filter(([, update]) => update.kind === "start").map(([, update]) => update);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SAME PASS: voice created + persisted this pass → the FIRST Final Setup send already links it", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const { client, createVoice } = makeStartClient({ send, edit: vi.fn(), voice: { nextId: "1552000000000000001" } });
    const api = makeStartApi({ existingMessageId: null, voiceChannelId: null, voiceChannels: [voiceItem("PROVISION", null)] });

    await syncOnce(client, voiceEnv(), api);

    expect(createVoice).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(api.recordDiscordState).mock.calls.map(([, update]) => update.kind);
    // Voice persisted before the Final Setup rendered from it.
    expect(calls.indexOf("voice-channel")).toBeLessThan(calls.indexOf("start"));
    expect(send).toHaveBeenCalledTimes(1);
    const content = contentOf(send);
    expect(content).toContain("Voice: <#1552000000000000001>");
    expect(content.indexOf("Voice:")).toBeGreaterThan(content.indexOf("🛡 **Tanks**"));
    expect(content.endsWith(formatFinalSetupLfgLine("Syntax"))).toBe(true);
    expect(startRecords(api)).toEqual([
      { kind: "start", channelId: CHANNEL_ID, messageId: "msg-new", voiceChannelId: "1552000000000000001" },
    ]);
  });

  it("PERSISTED: a Run untouched by this pass's voice lane links the persisted voice id", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const { client } = makeStartClient({ send, edit: vi.fn() });
    const api = makeStartApi({ existingMessageId: null, voiceChannelId: "444" });

    await syncOnce(client, botEnv(), api);

    expect(contentOf(send)).toContain("Voice: <#444>");
    expect(startRecords(api)).toEqual([{ kind: "start", channelId: CHANNEL_ID, messageId: "msg-new", voiceChannelId: "444" }]);
  });

  it("EXISTING POST self-heal: the posted Final Setup is edited in place to add the Voice line — no second message", async () => {
    const send = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const { client } = makeStartClient({ send, edit, existingMessageId: "msg-old", voice: { existing: { "555": 3 } } });
    const api = makeStartApi({ existingMessageId: "msg-old", voiceChannelId: "555", voiceChannels: [voiceItem("RECONCILE", "555")] });

    await syncOnce(client, voiceEnv(), api);

    expect(send).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(contentOf(edit)).toContain("Voice: <#555>");
    expect(startRecords(api)).toEqual([{ kind: "start", channelId: CHANNEL_ID, messageId: "msg-old", voiceChannelId: "555" }]);
  });

  it("REPLACED VOICE: old channel deleted → cleared (link removed) → replacement provisioned → Final Setup edited to the new id, in place", async () => {
    // Poll 1: the voice lane confirms 555 is gone (Unknown Channel) and clears it.
    const send1 = vi.fn();
    const edit1 = vi.fn().mockResolvedValue(undefined);
    const pass1 = makeStartClient({ send: send1, edit: edit1, existingMessageId: "msg-old", voice: { nextId: "666" } });
    const api1 = makeStartApi({ existingMessageId: "msg-old", voiceChannelId: "555", voiceChannels: [voiceItem("RECONCILE", "555")] });
    await syncOnce(pass1.client, voiceEnv(), api1);

    expect(api1.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "clear-voice-channel", channelId: "555" });
    expect(send1).not.toHaveBeenCalled();
    expect(contentOf(edit1)).not.toContain("<#555>");
    expect(startRecords(api1)).toEqual([{ kind: "start", channelId: CHANNEL_ID, messageId: "msg-old", voiceChannelId: null }]);

    // Poll 2: persisted id is now null → PROVISION creates + persists 666 → same-pass edit links it.
    const send2 = vi.fn();
    const edit2 = vi.fn().mockResolvedValue(undefined);
    const pass2 = makeStartClient({ send: send2, edit: edit2, existingMessageId: "msg-old", voice: { nextId: "666" } });
    const api2 = makeStartApi({ existingMessageId: "msg-old", voiceChannelId: null, voiceChannels: [voiceItem("PROVISION", null)] });
    await syncOnce(pass2.client, voiceEnv(), api2);

    expect(api2.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "voice-channel", channelId: "666" });
    expect(pass2.createVoice).toHaveBeenCalledTimes(1);
    expect(send2).not.toHaveBeenCalled();
    expect(edit2).toHaveBeenCalledTimes(1);
    const content = contentOf(edit2);
    expect(content).toContain("Voice: <#666>");
    expect(content).not.toContain("<#555>");
    expect(startRecords(api2)).toEqual([{ kind: "start", channelId: CHANNEL_ID, messageId: "msg-old", voiceChannelId: "666" }]);
  });

  it("EXPLICIT SAME-PASS NULL: voice confirmed gone this pass → no fallback to the old persisted id, Voice line removed", async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    // Voice category unset: the gone channel is cleared and nothing replaces it.
    const { client } = makeStartClient({ send: vi.fn(), edit, existingMessageId: "msg-old", voice: {} });
    const api = makeStartApi({ existingMessageId: "msg-old", voiceChannelId: "555", voiceChannels: [voiceItem("RECONCILE", "555")] });

    await syncOnce(client, botEnv(), api);

    expect(api.recordDiscordState).toHaveBeenCalledWith(RUN_ID, { kind: "clear-voice-channel", channelId: "555" });
    const content = contentOf(edit);
    expect(content).not.toContain("Voice:");
    expect(content).not.toContain("<#555>");
    expect(startRecords(api)).toEqual([{ kind: "start", channelId: CHANNEL_ID, messageId: "msg-old", voiceChannelId: null }]);
  });

  it("ROSTER REPLACEMENT: edited participant data keeps the correct Voice line", async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const { client } = makeStartClient({ send: vi.fn(), edit, existingMessageId: "msg-old", voice: { existing: { "555": 2 } } });
    const replaced = {
      ...startData,
      groups: {
        ...startData.groups,
        tanks: [{ ...startData.groups.tanks[0]!, signupId: "t2", userName: "Bulwark", discordUserId: "444", characterName: "Bulwark" }],
      },
    };
    const api = makeStartApi({ existingMessageId: "msg-old", data: replaced, voiceChannelId: "555", voiceChannels: [voiceItem("RECONCILE", "555")] });

    await syncOnce(client, voiceEnv(), api);

    const payload = edit.mock.calls[0]![0] as { content: string; allowedMentions: unknown };
    expect(payload.content).toContain("<@444>");
    expect(payload.content).not.toContain("<@111>");
    expect(payload.content.match(/Voice: <#555>/g)).toHaveLength(1);
    expect(payload.allowedMentions).toEqual({ parse: [], users: ["444"], roles: [], repliedUser: false });
  });

  it("NO VOICE: feature unavailable / no voice created → Final Setup exactly as before", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const { client, createVoice } = makeStartClient({ send, edit: vi.fn(), voice: {} });
    const api = makeStartApi({ existingMessageId: null, voiceChannelId: null, voiceChannels: [voiceItem("PROVISION", null)] });

    // DISCORD_RUN_VOICE_CATEGORY_ID unset.
    await syncOnce(client, botEnv(), api);

    expect(createVoice).not.toHaveBeenCalled();
    const content = contentOf(send);
    expect(content).not.toContain("Voice");
    expect(content).toBe(renderRunStartMessageText(startData, { classIndicators: { SHAMAN: "<:shaman:999>" } }));
  });

  it("ALLOWED MENTIONS: the channel mention does not broaden parse / users / roles on send or edit", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const edit = vi.fn().mockResolvedValue(undefined);
    const expected = { parse: [], users: ["111"], roles: [], repliedUser: false };

    const { client: sendClient } = makeStartClient({ send, edit: vi.fn() });
    await syncOnce(sendClient, botEnv(), makeStartApi({ existingMessageId: null, voiceChannelId: "444" }));
    const { client: editClient } = makeStartClient({ send: vi.fn(), edit, existingMessageId: "msg-old" });
    await syncOnce(editClient, botEnv(), makeStartApi({ existingMessageId: "msg-old", voiceChannelId: "444" }));

    for (const payload of [send.mock.calls[0]![0], edit.mock.calls[0]![0]] as Array<{ content: string; allowedMentions: unknown }>) {
      expect(payload.content).toContain("Voice: <#444>");
      expect(payload.allowedMentions).toEqual(expected);
      expect(payload.allowedMentions).toEqual(finalSetupAllowedMentions(startData));
    }
  });

  it("RAID INVITE regression: the same pass links the same-pass voice in both the Raid Invite DM and Final Setup", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-new", channelId: CHANNEL_ID });
    const { client, dmSend } = makeStartClient({ send, edit: vi.fn(), voice: { nextId: "777" } });
    const api = makeStartApi({
      existingMessageId: null,
      voiceChannelId: null,
      voiceChannels: [voiceItem("PROVISION", null)],
      notificationDms: [
        {
          notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          type: "RAID_INVITE",
          discordUserId: "111",
          runId: RUN_ID,
          signupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          runChannelId: CHANNEL_ID,
          voiceChannelId: null,
          productLabel: "Season 2 Bundle",
          scheduledStartAt: "2026-09-16T13:30:00.000Z",
          previousScheduledStartAt: null,
          difficulty: "HEROIC",
          lootType: "UNSAVED",
          participationType: "BOOSTER",
          selectedRole: "TANK",
          characterName: "Duskmaven",
          wowClass: "SHAMAN",
        },
      ],
    });

    await syncOnce(client, voiceEnv(), api);

    expect(contentOf(dmSend)).toContain("Voice: <#777>");
    expect(contentOf(send)).toContain("Voice: <#777>");
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

type StartVoiceItem = {
  runId: string;
  existingVoiceChannelId: string | null;
  desiredVoiceChannelName: string;
  action: "PROVISION" | "RECONCILE" | "RETIRE_IF_EMPTY";
};

function makeStartApi(input: {
  existingMessageId: string | null;
  data?: unknown;
  /** Persisted RunDiscordPost.voiceChannelId carried on the start work item. */
  voiceChannelId?: string | null;
  voiceChannels?: StartVoiceItem[];
  notificationDms?: Array<Record<string, unknown>>;
}): BotApiClient {
  return {
    listSyncWork: vi.fn().mockResolvedValue({
      channels: [],
      voiceChannels: input.voiceChannels ?? [],
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
          voiceChannelId: input.voiceChannelId ?? null,
        },
      ],
      notificationDms: input.notificationDms ?? [],
    }),
    recordDiscordState: vi.fn().mockResolvedValue(undefined),
    getRosterEmbedData: vi.fn().mockResolvedValue(null),
    getRunStartEmbedData: vi.fn().mockResolvedValue(input.data ?? startData),
  } as unknown as BotApiClient;
}

function makeStartClient(options: {
  send: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  existingMessageId?: string;
  /** Enables a voice category (DISCORD_RUN_VOICE_CATEGORY_ID) and these existing voice channels (id → members). */
  voice?: { existing?: Record<string, number>; nextId?: string };
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

  const voiceChannels = new Map<string, unknown>();
  const voiceChannel = (id: string, members: number) => ({
    id,
    name: "Raid with Syntax",
    type: ChannelType.GuildVoice,
    members: { size: members },
    setName: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  });
  for (const [id, members] of Object.entries(options.voice?.existing ?? {})) voiceChannels.set(id, voiceChannel(id, members));
  const createVoice = vi.fn(async () => {
    const created = voiceChannel(options.voice?.nextId ?? "voice-new", 0);
    voiceChannels.set(created.id, created);
    return created;
  });
  const voiceCategory = { id: VOICE_CATEGORY_ID, type: ChannelType.GuildCategory, guild: { channels: { create: createVoice } } };
  const dmSend = vi.fn().mockResolvedValue(undefined);

  const client = {
    channels: {
      cache: new Collection([[CHANNEL_ID, channel]]),
      fetch: vi.fn(async (id: string) => {
        if (id === CHANNEL_ID) return channel;
        if (!options.voice) return null;
        if (id === VOICE_CATEGORY_ID) return voiceCategory;
        const voice = voiceChannels.get(id);
        if (voice) return voice;
        throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
      }),
    },
    users: { fetch: vi.fn(async () => ({ send: dmSend })) },
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

  return { client: client as never, createVoice, dmSend };
}
