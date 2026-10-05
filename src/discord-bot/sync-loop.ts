import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  type CategoryChannel,
  type Client,
  type MessageEditOptions,
  type TextChannel,
  type VoiceChannel,
} from "discord.js";
import {
  effectiveVoiceChannelId,
  reconcileRunVoiceChannels,
  type ResolvedVoiceChannels,
  type RunVoiceChannelAdapters,
  type RunVoiceChannelWorkItem,
} from "@/discord-bot/voice-channels";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { syncGlobalAnnouncements } from "@/discord-bot/global-announcements";
import {
  isDiscordCannotDmError,
  isDiscordPermissionError,
  isDiscordUnknownChannelError,
  isDiscordUnknownMessageError,
} from "@/discord-bot/discord-api-errors";
import { fetchChannelTranscript } from "@/discord-bot/transcript-fetch";
import {
  createReportScanState,
  scanReportChannels,
  scanRunChannelsForReports,
  type ScannableMessage,
} from "@/discord-bot/warcraft-logs-links";
import {
  buildArchiveServerInfoContent,
  buildArchiveTranscriptFilename,
  buildArchiveTranscriptHtml,
  summarizeTranscriptUsers,
  transcriptMessageContent,
  type TranscriptMessage,
} from "@/discord-bot/archive-transcript";
import { getMessageContentStatus, type MessageContentStatus } from "@/discord-bot/message-content";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import {
  buildRaidboostAnnounce,
  RAIDBOOST_ANNOUNCE_EMOJI_NAME,
  RAIDBOOST_PING_ROLE_NAMES,
} from "@/discord-bot/embeds/raidboost-announce";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import {
  resolveGuildEmojiIndicators,
  type GuildClassIndicators,
  fingerprintClassIndicators,
  fingerprintRoleIndicators,
  type GuildRoleIndicators,
} from "@/discord-bot/class-emoji-lookup";
import { buildRaidInviteMessage } from "@/discord-bot/messages/raid-invite-message";
import {
  buildRunCancelledChannelEmbed,
  buildRunReactivatedChannelEmbed,
  buildRunRescheduledChannelEmbed,
} from "@/discord-bot/embeds/run-lifecycle-announcement";
import {
  buildRosterSelectedDmMessage,
  buildRosterRemovedDmMessage,
  buildRosterWithdrawnDmMessage,
  buildRunCancelledDmMessage,
  buildRunReactivatedDmMessage,
  buildRunRescheduledDmMessage,
} from "@/services/notification-content";
import { finalSetupAllowedMentions, renderRunStartMessageText } from "@/discord-bot/messages/run-start-message";
import {
  mergeWeekSectionItemsForOrdering,
  reconcileChannels,
  reconcileWeekSectionPositionsUntilSettled,
  type CategoryChannelLister,
  type ChannelFetcher,
  type PositionSetter,
  type ReconcilableChannel,
  type WeekSectionItem,
} from "@/discord-bot/channel-reconciliation";
import type { RosterEmbedData, RunStartEmbedData, SignupEmbedData } from "@/services/discord-sync.service";

type SyncWork = Awaited<ReturnType<BotApiClient["listSyncWork"]>>;

/** Warcraft Logs link scan throttle / final-scan bookkeeping (per process; the cursor itself is durable). */
const warcraftLogsScanState = createReportScanState();
type ChannelLaneItem = SyncWork["channels"][number];
type SignupLaneItem = SyncWork["signups"][number];
type RosterLaneItem = SyncWork["roster"][number];
type StartLaneItem = NonNullable<SyncWork["start"]>[number];
type RaidInviteLaneItem = NonNullable<SyncWork["raidInvites"]>[number];
type NotificationDmLaneItem = NonNullable<SyncWork["notificationDms"]>[number];
type RunAnnouncementLaneItem = NonNullable<SyncWork["runAnnouncements"]>[number];

/** Minimal fields shared by every lane that may resolve a Run channel. */
type RunChannelResolveItem = {
  runId: string;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
};

type ResolvedRunChannel = {
  channelId: string;
  /** True only when this sync pass created the channel under the active category. */
  created: boolean;
};

/**
 * Starts polling GET /api/bot/discord/sync. Discord availability never
 * blocks a Run state transition in BoostingHub — a failed pass is logged and
 * retried on the next tick rather than thrown out of the bot process.
 *
 * Concurrent kicks coalesce: at most one pass runs at a time, and any
 * `requestImmediateSync()` during a pass schedules exactly one follow-up.
 */
let syncContext: { client: Client; env: BotEnv; api: BotApiClient } | null = null;
let syncInFlight: Promise<void> | null = null;
let syncPending = false;

async function triggerSync(): Promise<void> {
  if (!syncContext) return;
  if (syncInFlight) {
    syncPending = true;
    return;
  }
  const { client, env, api } = syncContext;
  syncInFlight = syncOnce(client, env, api)
    .catch((error) => {
      console.error("[discord-bot] sync pass failed", error);
    })
    .finally(() => {
      syncInFlight = null;
      if (syncPending) {
        syncPending = false;
        void triggerSync();
      }
    });
  await syncInFlight;
}

/**
 * Run a sync pass as soon as possible (coalesced). Used after Discord
 * mutations so signup/roster embeds update without waiting for the poll tick.
 */
export function requestImmediateSync(): void {
  void triggerSync();
}

export function startSyncLoop(client: Client, env: BotEnv, api: BotApiClient): NodeJS.Timeout {
  syncContext = { client, env, api };
  void triggerSync();
  return setInterval(() => {
    void triggerSync();
  }, env.syncIntervalMs);
}

/**
 * Resolves a channel id to the narrow shape channel-reconciliation.ts needs,
 * or null if it resolves to nothing reconcilable. Cache-first
 * (`client.channels.cache`) to avoid an unnecessary REST call on every poll;
 * falls back to `fetch` on a cache miss. Every Discord error — including
 * Unknown Channel — is rethrown so reconciliation can tell a confirmed
 * deletion apart from a live but inaccessible channel.
 */
function makeChannelFetcher(client: Client): ChannelFetcher {
  return async (channelId) => {
    const cached = client.channels.cache.get(channelId);
    const channel = cached ?? (await client.channels.fetch(channelId));
    if (!channel || !("setName" in channel) || !("setParent" in channel) || !("parentId" in channel)) {
      return null;
    }
    const typed = channel as unknown as {
      id: string;
      name: string;
      parentId: string | null;
      setName: (name: string) => Promise<unknown>;
      setParent: (id: string, options?: { lockPermissions?: boolean }) => Promise<unknown>;
    };
    const reconcilable: ReconcilableChannel = {
      id: typed.id,
      name: typed.name,
      parentId: typed.parentId,
      setName: (name) => typed.setName(name),
      setParent: (id, options) => typed.setParent(id, options),
    };
    return reconcilable;
  };
}

function mapCategoryChildren(
  channels: Iterable<{ id: string; position?: number; parentId?: string | null; name?: string | null }>,
  categoryId: string | null,
): Array<{ id: string; position: number; name?: string }> {
  return [...channels]
    .filter((channel) => {
      if (categoryId === null) return true;
      return "parentId" in channel && channel.parentId === categoryId;
    })
    .map((channel) => ({
      id: channel.id,
      position: typeof channel.position === "number" ? channel.position : 0,
      ...(typeof channel.name === "string" ? { name: channel.name } : {}),
    }));
}

/**
 * Lists the current children of a category by their live `position`, for
 * planning `reconcileWeekSectionPositions`. Prefers the category's own
 * `children` cache (updated immediately by `guild.channels.create({ parent })`)
 * and falls back to scanning the client channel cache by `parentId`.
 *
 * Do not use this alone to prove Discord accepted a position write — use
 * `makeFreshCategoryChannelLister` after `setPositions`.
 */
function makeCategoryChannelLister(client: Client): CategoryChannelLister {
  return async (categoryId) => {
    const category = await client.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return null;
    }
    const fromCategoryChildren = (category as CategoryChannel).children?.cache;
    if (fromCategoryChildren && fromCategoryChildren.size > 0) {
      return mapCategoryChildren(fromCategoryChildren.values(), null);
    }
    return mapCategoryChildren(
      client.channels.cache.values() as Iterable<{ id: string; position?: number; parentId?: string | null }>,
      categoryId,
    );
  };
}

/**
 * Fresh REST-backed category child listing used to verify post-write order.
 * Forces `guild.channels.fetch()` so success is not judged from the
 * create-time cache view alone (live Discord can lag that cache).
 */
function makeFreshCategoryChannelLister(client: Client, guildId: string): CategoryChannelLister {
  return async (categoryId) => {
    const guild = await client.guilds.fetch(guildId);
    // GET /guilds/{id}/channels — refresh positions from Discord, not cache.
    await guild.channels.fetch();
    const category = guild.channels.cache.get(categoryId) ?? (await client.channels.fetch(categoryId).catch(() => null));
    if (!category || category.type !== ChannelType.GuildCategory) {
      return null;
    }
    const fromCategoryChildren = (category as CategoryChannel).children?.cache;
    if (fromCategoryChildren && fromCategoryChildren.size > 0) {
      return mapCategoryChildren(fromCategoryChildren.values(), null);
    }
    return mapCategoryChildren(
      guild.channels.cache.values() as Iterable<{ id: string; position?: number; parentId?: string | null }>,
      categoryId,
    );
  };
}

/** Applies a full desired ordering in one guild-level batched call. */
function makePositionSetter(client: Client, guildId: string): PositionSetter {
  return async (moves) => {
    const guild = await client.guilds.fetch(guildId);
    return guild.channels.setPositions(moves.map((move) => ({ channel: move.channelId, position: move.position })));
  };
}

/**
 * One Discord sync pass. Exported for orchestration tests — production entry
 * remains `startSyncLoop`.
 *
 * Position reconciliation always runs after channel provisioning is known,
 * even when a later signup/roster message send/edit fails. Otherwise a brand
 * new CURRENT channel could remain below `#next-id` until the next poll.
 */
export async function syncOnce(client: Client, env: BotEnv, api: BotApiClient): Promise<void> {
  // One cached Guild emoji snapshot serves both class and role indicators.
  const { classIndicators, roleIndicators } = await resolveGuildEmojiIndicators(client, env.discordGuildId);
  const classEmojiFingerprint = [
    fingerprintClassIndicators(classIndicators),
    fingerprintRoleIndicators(roleIndicators),
  ].join("||");
  const work: SyncWork = await api.listSyncWork(classEmojiFingerprint);

  // One-time product announcements — independent of Run / Schedule / Guide lanes.
  // Failures are logged inside; they must never block normal Discord sync.
  await syncGlobalAnnouncements(client, env, api);

  // Channel reconciliation (name + parent category) runs first and
  // independently of message state — a Run's channel should already be in
  // its correct place before any new signup/roster message work is applied.
  // The resulting map lets the message paths below reuse the same resolved
  // channel instead of re-resolving (and potentially re-renaming/re-moving)
  // it a second time within the same pass. A channel Discord confirms deleted
  // is recorded as `channel-gone` once, so it stops reappearing every poll.
  const resolvedChannels = await reconcileChannels(
    makeChannelFetcher(client),
    { discordRunCategoryId: env.discordRunCategoryId, discordRunArchiveCategoryId: env.discordRunArchiveCategoryId },
    work.channels,
    async (gone) => {
      await api.recordDiscordState(gone.runId, { kind: "channel-gone", channelId: gone.existingRunChannelId });
    },
  );

  // Temporary Run voice channels next — independent of text channels and of
  // their ordering — so Raid Invite DMs later in this same pass can link a
  // voice channel created now.
  const resolvedVoiceChannels = await syncRunVoiceChannels(client, env, api, work.voiceChannels ?? []);

  // Trusted log-bot Warcraft Logs links in running / just-completed Run
  // channels: every message after the durable per-channel cursor, oldest →
  // newest. A retiring channel is scanned to its end first; if that cannot
  // finish, its deletion waits (bounded) so no report link is lost.
  let deferRetirement = new Set<string>();
  try {
    deferRetirement = await scanRunChannelsForReports({
      items: work.channels.map((item) => ({
        runId: item.runId,
        channelId: resolvedChannels.get(item.runId) ?? item.existingRunChannelId,
        scanWarcraftLogs: item.scanWarcraftLogs,
        retireChannel: item.retireChannel,
        warcraftLogsScanCursor: item.warcraftLogsScanCursor ?? null,
      })),
      trustedAuthorIds: work.warcraftLogsReportAuthorIds ?? [],
      fetchPage: (channelId, options) => fetchScannableMessagePage(client, channelId, options),
      attach: (runId, input) => api.attachWarcraftLogsReport(runId, input),
      saveCursor: async (runId, channelId, messageId) => {
        await api.recordDiscordState(runId, { kind: "wcl-scan-cursor", channelId, messageId });
      },
      state: warcraftLogsScanState,
    });
  } catch (error) {
    console.error("[discord-bot] Warcraft Logs link scan failed", error);
  }

  // Dedicated Warcraft Logs log channels: read once per pass (not per Run);
  // the server matches what it finds to Runs. Never holds back archival.
  try {
    await scanReportChannels({
      channels: work.warcraftLogsReportChannels ?? [],
      trustedAuthorIds: work.warcraftLogsReportAuthorIds ?? [],
      fetchPage: (channelId, options) => fetchScannableMessagePage(client, channelId, options),
      record: (input) => api.recordWarcraftLogsDiscovery(input),
      saveCursor: async (channelId, messageId) => {
        await api.saveWarcraftLogsChannelCursor(channelId, messageId);
      },
      state: warcraftLogsScanState,
    });
  } catch (error) {
    console.error("[discord-bot] Warcraft Logs log channel scan failed", error);
  }

  // Lifecycle channel announcements that must land before retirement
  // (cancel / reschedule) post first. RUN_REACTIVATED waits until after
  // signup provisioning so a replacement channel from continuity recovery
  // can be used in the same pass.
  const earlyAnnouncements = (work.runAnnouncements ?? []).filter(
    (item) => item.type !== "RUN_REACTIVATED",
  );
  const reactivatedAnnouncements = (work.runAnnouncements ?? []).filter(
    (item) => item.type === "RUN_REACTIVATED",
  );
  if (earlyAnnouncements.length > 0) {
    for (const item of earlyAnnouncements) {
      try {
        await syncRunAnnouncement(client, api, item, resolvedChannels);
      } catch (error) {
        console.error(
          `[discord-bot] run announcement ${item.announcementId} failed for run ${item.runId}`,
          error,
        );
      }
    }
  }

  for (const item of work.channels) {
    if (!item.retireChannel) continue;
    if (deferRetirement.has(item.runId)) {
      console.warn(`[discord-bot] holding back retirement of run ${item.runId}: final Warcraft Logs link scan not finished`);
      continue;
    }
    try {
      await syncArchiveArtifacts(client, env, api, item, resolvedChannels);
    } catch (error) {
      console.error(`[discord-bot] archive artifacts failed for run ${item.runId}`, error);
    }
  }

  // Global CURRENT/NEXT Schedule posts — fully independent of archival and of
  // per-Run message lanes. Failures here never block signup/roster/archive.
  try {
    await syncSchedulePosts(client, env, api, work.schedules ?? []);
  } catch (error) {
    console.error("[discord-bot] schedule sync failed", error);
  }

  // CURRENT/NEXT section ordering runs once after provisioning so same-pass
  // creates are included. It must not be skipped merely because a later
  // signup/roster embed send fails — wrap message work and always reconcile
  // in `finally`. Later polls still self-heal drift via work.channels.
  const newlyProvisionedSections: WeekSectionItem[] = [];
  let messagePhaseError: unknown = null;

  try {
    for (const item of work.signups) {
      if (!item.embed) continue;
      try {
        const createdSection = await syncSignupPost(
          client,
          env,
          api,
          item,
          item.embed as SignupEmbedData,
          resolvedChannels,
          classIndicators,
          roleIndicators,
          classEmojiFingerprint,
        );
        if (createdSection) newlyProvisionedSections.push(createdSection);
      } catch (error) {
        console.error(`[discord-bot] signup sync failed for run ${item.runId}`, error);
        messagePhaseError ??= error;
      }
    }

    for (const item of work.roster) {
      try {
        const data = (await api.getRosterEmbedData(item.runId).catch(() => null)) as RosterEmbedData | null;
        if (!data) continue;
        await syncRosterPost(
          client,
          env,
          api,
          item,
          data,
          resolvedChannels,
          classIndicators,
          roleIndicators,
          classEmojiFingerprint,
        );
      } catch (error) {
        console.error(`[discord-bot] roster sync failed for run ${item.runId}`, error);
        messagePhaseError ??= error;
      }
    }

    // After continuity recovery may have provisioned a replacement channel.
    for (const item of reactivatedAnnouncements) {
      try {
        await syncRunAnnouncement(client, api, item, resolvedChannels);
      } catch (error) {
        console.error(
          `[discord-bot] run announcement ${item.announcementId} failed for run ${item.runId}`,
          error,
        );
        messagePhaseError ??= error;
      }
    }

    for (const item of work.start ?? []) {
      try {
        const data = (await api.getRunStartEmbedData(item.runId).catch(() => null)) as RunStartEmbedData | null;
        if (!data) continue;
        await syncStartPost(client, env, api, item, data, resolvedChannels, classIndicators, resolvedVoiceChannels);
      } catch (error) {
        console.error(`[discord-bot] start sync failed for run ${item.runId}`, error);
        messagePhaseError ??= error;
      }
    }

    if ((work.raidInvites ?? []).length > 0) {
      for (const item of work.raidInvites ?? []) {
        try {
          await syncRaidInvite(client, api, item);
        } catch (error) {
          console.error(
            `[discord-bot] raid invite DM failed for signup ${item.signupId} on run ${item.runId}`,
            error,
          );
          messagePhaseError ??= error;
        }
      }
    }

    if ((work.notificationDms ?? []).length > 0) {
      for (const item of work.notificationDms ?? []) {
        try {
          await syncNotificationDm(client, api, item, resolvedVoiceChannels);
        } catch (error) {
          console.error(
            `[discord-bot] notification DM failed for ${item.notificationId} (${item.type})`,
            error,
          );
          messagePhaseError ??= error;
        }
      }
    }
  } finally {
    const baseLister = makeCategoryChannelLister(client);
    const freshLister = makeFreshCategoryChannelLister(client, env.discordGuildId);
    // Same-pass creates normally enter the category children cache immediately,
    // but do not depend on that alone: overlay any newly provisioned channel
    // ids so setPositions can still place them if the listing briefly lags.
    // Only newly provisioned ids are overlaid — never resurrect a deleted
    // stored runChannelId from work.channels that is absent from Discord.
    const withSamePassCreates = (lister: CategoryChannelLister): CategoryChannelLister => {
      return async (categoryId) => {
        const children = await lister(categoryId);
        if (!children) return null;
        const byId = new Map(children.map((child) => [child.id, child]));
        let nextPosition = children.reduce((max, child) => Math.max(max, child.position), -1);
        for (const item of newlyProvisionedSections) {
          if (byId.has(item.existingRunChannelId)) continue;
          nextPosition += 1;
          byId.set(item.existingRunChannelId, {
            id: item.existingRunChannelId,
            position: nextPosition,
          });
        }
        return [...byId.values()];
      };
    };

    // Create-time GuildChannelCreateOptions.position was audited and not used
    // as a first-line placement: it cannot encode full CURRENT/NEXT chronology
    // around markers without duplicating the canonical planner, and Discord's
    // create→position visibility still needs post-write reconcile+verify.
    // Source of truth remains reconcileWeekSectionPositions (+ settle).
    await reconcileWeekSectionPositionsUntilSettled(
      withSamePassCreates(baseLister),
      withSamePassCreates(freshLister),
      makePositionSetter(client, env.discordGuildId),
      {
        discordRunCategoryId: env.discordRunCategoryId,
        discordRunCurrentMarkerChannelId: env.discordRunCurrentMarkerChannelId,
        discordRunNextMarkerChannelId: env.discordRunNextMarkerChannelId,
      },
      mergeWeekSectionItemsForOrdering(work.channels, newlyProvisionedSections),
    );
  }

  if (messagePhaseError) {
    throw messagePhaseError;
  }
}

/**
 * Temporary per-Run GuildVoice channels (see voice-channels.ts).
 * DISCORD_RUN_VOICE_CATEGORY_ID controls FIRST creation only: it is resolved
 * only when this pass has PROVISION work. Unset → nothing new is created; an
 * id that is not a GuildCategory → operator error, nothing created, no
 * fallback. Either way, already-created channels are still fetched, kept,
 * renamed and cleaned up, so removing the env never orphans them.
 * Never throws — voice is a convenience and must not break the sync pass.
 */
async function syncRunVoiceChannels(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  items: RunVoiceChannelWorkItem[],
): Promise<ResolvedVoiceChannels> {
  if (items.length === 0) return new Map();
  const voiceCategoryId = env.discordRunVoiceCategoryId ?? null;

  try {
    let createVoiceChannel: RunVoiceChannelAdapters["createVoiceChannel"] = null;
    if (voiceCategoryId && items.some((item) => item.action === "PROVISION")) {
      const category = await client.channels.fetch(voiceCategoryId).catch(() => null);
      if (category && category.type === ChannelType.GuildCategory) {
        createVoiceChannel = async (name) => {
          const created = await (category as CategoryChannel).guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: category.id,
          });
          return { id: created.id, delete: (reason) => created.delete(reason) };
        };
      } else {
        console.error(
          `[discord-bot] DISCORD_RUN_VOICE_CATEGORY_ID ${voiceCategoryId} does not resolve to a category — no Run voice channels will be created`,
        );
      }
    }

    const adapters: RunVoiceChannelAdapters = {
      fetchChannel: async (channelId) => {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return { kind: "unresolved" };
        if (channel.type !== ChannelType.GuildVoice) return { kind: "other" };
        const voice = channel as VoiceChannel;
        return {
          kind: "voice",
          name: voice.name,
          memberCount: voice.members.size,
          setName: (name) => voice.setName(name),
          delete: (reason) => voice.delete(reason),
        };
      },
      createVoiceChannel,
      recordVoiceChannel: async (runId, channelId) => {
        await api.recordDiscordState(runId, { kind: "voice-channel", channelId });
      },
      clearVoiceChannel: async (runId, channelId) => {
        await api.recordDiscordState(runId, { kind: "clear-voice-channel", channelId });
      },
    };
    return await reconcileRunVoiceChannels(adapters, items);
  } catch (error) {
    console.error("[discord-bot] Run voice channel sync failed", error);
    return new Map();
  }
}

/**
 * Resolves the Discord channel a Run's posts belong in.
 *
 * Preferred (per-Run) mode — `DISCORD_RUN_CATEGORY_ID` configured: creates
 * the Run's own dedicated text channel once under that ONE category
 * (recorded immediately via the "channel" discord-state kind, before any
 * message is posted) — CURRENT and NEXT share this same category; only
 * ordering (see `reconcileWeekSectionPositions`) distinguishes them
 * visually, not which parent they get created under. Renaming and category
 * movement for an already-existing channel are no longer this function's
 * job — they happen unconditionally and independently via
 * `channel-reconciliation.ts`/`reconcileChannels`, before this function ever
 * runs (see `syncOnce`). This function only needs to know the resolved
 * channel id — reusing it from `resolvedChannels` when available — and,
 * failing that, whether the stored id is confirmed gone in Discord. A fresh
 * channel is created only when `allowCreate` is true AND Discord returned
 * Unknown Channel (10003) — never on Missing Access / rate limits / transient
 * errors, which would orphan a still-live channel on every bot restart.
 *
 * `allowCreate` (true for the signup path, false for the roster path) is
 * the fix for a real bug found in live QA: the roster sync path is gated
 * only by "has a published roster", with no `isSignupWindowOpen` check —
 * so a Run whose roster was published without the bot ever observing its
 * signup phase (seeded/historical data, or the bot being offline through
 * the whole signup window) would otherwise get a channel created from
 * scratch by the roster path alone, defeating the signup-side rule that a
 * Run never gets retroactive Discord infrastructure for a phase that's
 * already over. Only the signup path — itself gated by `isSignupWindowOpen`
 * + week bucket in `listSyncWork` — may create a Run's first channel; the
 * roster path may only reuse one that already exists.
 *
 * Legacy mode — no category configured: always the single global channel
 * from env (`DISCORD_SIGNUP_CHANNEL_ID` / `DISCORD_ROSTER_CHANNEL_ID`).
 */
async function resolveRunChannel(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: RunChannelResolveItem,
  legacyFallbackChannelId: string | null,
  allowCreate: boolean,
  resolvedChannels: Map<string, string>,
): Promise<ResolvedRunChannel | null> {
  if (!env.discordRunCategoryId) {
    return legacyFallbackChannelId ? { channelId: legacyFallbackChannelId, created: false } : null;
  }

  // Same-pass continuity: signup may have just provisioned a replacement.
  const alreadyResolved = resolvedChannels.get(item.runId);
  if (alreadyResolved) return { channelId: alreadyResolved, created: false };

  if (item.existingRunChannelId) {
    // Not reconciled this pass — defensive only; every Run with a persisted
    // runChannelId is always included in work.channels, so this should
    // never actually be reached. Just verify the id still resolves; name
    // and category reconciliation are reconcileChannels' job, never
    // repeated here, so the same channel is never renamed/moved twice in
    // one pass.
    try {
      const existing = await client.channels.fetch(item.existingRunChannelId);
      if (existing) {
        resolvedChannels.set(item.runId, item.existingRunChannelId);
        return { channelId: item.existingRunChannelId, created: false };
      }
      console.warn(
        `[discord-bot] run ${item.runId}'s channel ${item.existingRunChannelId} resolved to an incompatible type — keeping stored id, not recreating`,
      );
      return { channelId: item.existingRunChannelId, created: false };
    } catch (error) {
      if (!isDiscordUnknownChannelError(error)) {
        console.warn(
          `[discord-bot] run ${item.runId}'s channel ${item.existingRunChannelId} is temporarily inaccessible — keeping stored id, not recreating`,
          error,
        );
        return { channelId: item.existingRunChannelId, created: false };
      }
      if (!allowCreate) {
        // Confirmed deleted and no replacement is permitted: persist that, so
        // listSyncWork stops re-targeting the dead id on every poll.
        console.warn(
          `[discord-bot] run ${item.runId}'s channel ${item.existingRunChannelId} is gone in Discord (Unknown Channel) and may not be replaced — clearing its stored identity`,
        );
        await api.recordDiscordState(item.runId, { kind: "channel-gone", channelId: item.existingRunChannelId });
        return null;
      }
      console.warn(
        `[discord-bot] run ${item.runId}'s channel ${item.existingRunChannelId} is gone in Discord (Unknown Channel) — provisioning a replacement`,
      );
      // Confirmed deleted — fall through to create.
    }
  }

  if (!allowCreate) {
    // Only first provisioning / continuity recovery (signup lane) may create.
    // Continuity after archive-only clear must not recreate — that re-fires role pings.
    console.warn(
      `[discord-bot] run ${item.runId} has no usable channel and channel create is not allowed — skipping (no re-ping)`,
    );
    return null;
  }

  const category = await client.channels.fetch(env.discordRunCategoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    console.error(`[discord-bot] DISCORD_RUN_CATEGORY_ID does not resolve to a category — skipping run ${item.runId}`);
    return null;
  }

  const created = await (category as CategoryChannel).guild.channels.create({
    name: item.desiredChannelName,
    type: ChannelType.GuildText,
    parent: category.id,
  });
  await api.recordDiscordState(item.runId, { kind: "channel", channelId: created.id });
  resolvedChannels.set(item.runId, created.id);
  return { channelId: created.id, created: true };
}

async function syncSignupPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: SignupLaneItem,
  data: SignupEmbedData,
  resolvedChannels: Map<string, string>,
  classIndicators: GuildClassIndicators,
  roleIndicators: GuildRoleIndicators,
  classEmojiFingerprint: string,
): Promise<WeekSectionItem | null> {
  const resolved = await resolveRunChannel(
    client,
    env,
    api,
    item,
    env.discordSignupChannelId,
    item.allowChannelCreate === true,
    resolvedChannels,
  );
  if (!resolved) return null;
  const { channelId, created } = resolved;
  // Capture same-pass ordering metadata before message work — send/edit/
  // recordDiscordState failures must not erase the fact that a CURRENT/NEXT
  // channel was provisioned and needs immediate section placement.
  const section = createdSectionItem(item, channelId, created);

  try {
    // A recreated channel for a Run whose signup already went out once must
    // not ping the Raidboost roles again. Older API payloads omit the flag.
    if (created && item.announceOnCreate !== false) {
      await postRaidboostAnnounce(client, env, channelId, data);
    }

    const embed = buildSignupEmbed(data, { classIndicators, roleIndicators });
    const row = buildSignupButtons(data);
    const payload: MessageEditOptions = { embeds: [embed], components: [row] };

    // Local QA may still hold comma-separated multi-message ids from an earlier
    // experiment — treat those as invalid and repost a single message.
    const existingId = item.existingMessageId;
    const isLegacyMulti = Boolean(existingId && existingId.includes(","));

    if (existingId && !isLegacyMulti) {
      const edited = await tryEditMessage(client, channelId, existingId, payload);
      if (edited) {
        await api.recordDiscordState(data.runId, {
          kind: "signup",
          channelId,
          messageId: existingId,
          classEmojiFingerprint,
        });
        return section;
      }
      // The stored message is gone (deleted in Discord) — fall through and repost.
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      return section;
    }

    if (isLegacyMulti && existingId) {
      for (const staleId of existingId.split(",").map((part) => part.trim()).filter(Boolean)) {
        try {
          const stale = await channel.messages.fetch(staleId);
          await stale.delete();
        } catch {
          // Missing/stale ids are fine — we are about to post one fresh message.
        }
      }
    }

    const message = await channel.send({ embeds: [embed], components: [row] });
    await api.recordDiscordState(data.runId, {
      kind: "signup",
      channelId: message.channelId,
      messageId: message.id,
      classEmojiFingerprint,
    });
  } catch (error) {
    // Channel identity is already persisted; message work retries next poll.
    // Still return `section` so same-pass CURRENT/NEXT positioning includes
    // this newly created channel.
    console.error(`[discord-bot] signup message sync failed for run ${item.runId} (channel ${channelId})`, error);
  }
  return section;
}

function createdSectionItem(
  item: Pick<SignupLaneItem, "runId" | "targetBucket" | "scheduledStartAt">,
  channelId: string,
  created: boolean,
): WeekSectionItem | null {
  if (!created) return null;
  if (item.targetBucket !== "CURRENT" && item.targetBucket !== "NEXT") return null;
  return {
    runId: item.runId,
    existingRunChannelId: channelId,
    targetBucket: item.targetBucket,
    scheduledStartAt: item.scheduledStartAt,
  };
}

/**
 * One-shot Carl-bot-style open announce into a freshly created Run channel:
 * Phoenix emoji title + @tank @healer @dps content pings. Never re-posted on
 * later polls (`created` is true only for same-pass channel provisioning).
 *
 * Role resolution prefers the channel's own guild (same server as the Run
 * channel), then optional env role ids, then case-insensitive role names.
 */
async function postRaidboostAnnounce(
  client: Client,
  env: BotEnv,
  channelId: string,
  data: Pick<SignupEmbedData, "difficulty" | "lootType" | "runId" | "discordRolePing">,
): Promise<void> {
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    if (isDiscordPermissionError(error) || isDiscordUnknownChannelError(error)) {
      console.warn(
        `[discord-bot] cannot fetch channel ${channelId} for raidboost announce on run ${data.runId} — skipping`,
        error,
      );
      return;
    }
    throw error;
  }
  if (!channel?.isTextBased() || !("send" in channel)) return;

  let phoenixEmoji: string | null = null;
  const roleMentions: string[] = [];
  const roleIds: string[] = [];
  try {
    const guild =
      "guild" in channel && channel.guild
        ? channel.guild
        : await client.guilds.fetch(env.discordGuildId);
    await guild.emojis.fetch();
    const fetchedRoles = await guild.roles.fetch();
    const roles = fetchedRoles ?? guild.roles.cache;

    const phoenix = guild.emojis.cache.find((emoji) => emoji.name === RAIDBOOST_ANNOUNCE_EMOJI_NAME);
    if (phoenix) phoenixEmoji = phoenix.toString();
    else {
      console.warn(
        `[discord-bot] guild emoji ${RAIDBOOST_ANNOUNCE_EMOJI_NAME} missing on ${guild.name} — raidboost announce title without phoenix`,
      );
    }

    if (data.discordRolePing) {
      const envRoleIds: Record<(typeof RAIDBOOST_PING_ROLE_NAMES)[number], string | null> = {
        tank: env.discordPingRoleTankId,
        healer: env.discordPingRoleHealerId,
        dps: env.discordPingRoleDpsId,
      };

      for (const name of RAIDBOOST_PING_ROLE_NAMES) {
        const fromEnv = envRoleIds[name];
        const role = fromEnv
          ? (roles.get(fromEnv) ?? null)
          : (roles.find((entry) => entry.name.toLowerCase() === name) ?? null);
        if (role) {
          roleMentions.push(`<@&${role.id}>`);
          roleIds.push(role.id);
          if (!role.mentionable) {
            // Bots can still notify via allowedMentions; surface for operators.
            console.warn(
              `[discord-bot] role "${role.name}" is not mentionable — pinging via allowedMentions anyway`,
            );
          }
        } else {
          console.warn(
            `[discord-bot] guild role "${name}" missing on ${guild.name}${fromEnv ? ` (env id ${fromEnv})` : ""} — omitting from raidboost announce ping`,
          );
        }
      }
    }
  } catch (error) {
    console.warn(`[discord-bot] failed resolving raidboost announce emoji/roles for run ${data.runId}`, error);
  }

  if (data.discordRolePing && roleMentions.length === 0) {
    console.warn(
      `[discord-bot] raidboost announce for run ${data.runId} has no role pings — posting embed only`,
    );
  }

  const announce = buildRaidboostAnnounce({
    runId: data.runId,
    difficulty: data.difficulty,
    lootType: data.lootType,
    phoenixEmoji,
    roleMentions,
  });

  try {
    await (channel as TextChannel).send({
      content: announce.content || undefined,
      embeds: announce.embeds,
      allowedMentions: { parse: [], roles: roleIds, users: [], repliedUser: false },
    });
  } catch (error) {
    if (isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] missing permission to post raidboost announce for run ${data.runId} — skipping`,
        error,
      );
      return;
    }
    throw error;
  }
}

async function syncRosterPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: RosterLaneItem,
  data: RosterEmbedData,
  resolvedChannels: Map<string, string>,
  classIndicators: GuildClassIndicators,
  roleIndicators: GuildRoleIndicators,
  classEmojiFingerprint: string,
): Promise<void> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false, resolvedChannels);
  if (!resolved) return;
  const { channelId } = resolved;

  const embed = buildRosterEmbed(data, { classIndicators, roleIndicators });
  const fulfillPostRevision =
    item.mode === "POST" && typeof item.postRevision === "number" ? item.postRevision : undefined;

  // Always edit the single persistent Roster message when it exists. Publish
  // only acknowledges postRevision on that same message — never appends a
  // second historical Roster post. Missing / deleted → send exactly one.
  if (item.existingMessageId) {
    const edited = await tryEditMessage(client, channelId, item.existingMessageId, { embeds: [embed] });
    if (edited) {
      await api.recordDiscordState(item.runId, {
        kind: "roster",
        channelId,
        messageId: item.existingMessageId,
        classEmojiFingerprint,
        ...(fulfillPostRevision !== undefined ? { postRevision: fulfillPostRevision } : {}),
      });
      return;
    }
    // The current message is gone (deleted in Discord) — fall through and re-send (recovery).
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ embeds: [embed] });
  await api.recordDiscordState(item.runId, {
    kind: "roster",
    channelId: message.channelId,
    messageId: message.id,
    classEmojiFingerprint,
    ...(fulfillPostRevision !== undefined ? { postRevision: fulfillPostRevision } : {}),
  });
}

async function syncStartPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: StartLaneItem,
  data: RunStartEmbedData,
  resolvedChannels: Map<string, string>,
  classIndicators: GuildClassIndicators,
  resolvedVoiceChannels: ResolvedVoiceChannels,
): Promise<void> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false, resolvedChannels);
  if (!resolved) return;
  const { channelId } = resolved;

  // Display only: the voice lane above already provisioned/replaced/cleared.
  const voiceChannelId = effectiveVoiceChannelId(resolvedVoiceChannels, item.runId, item.voiceChannelId);
  const content = renderRunStartMessageText(data, { classIndicators, voiceChannelId });
  // Same explicit policy for send and edit: only selected roster users may be pinged.
  const allowedMentions = finalSetupAllowedMentions(data);
  const editPayload: MessageEditOptions = { content, embeds: [], allowedMentions };

  if (item.existingMessageId) {
    const edited = await tryEditMessage(client, channelId, item.existingMessageId, editPayload);
    if (edited) {
      await api.recordDiscordState(item.runId, {
        kind: "start",
        channelId,
        messageId: item.existingMessageId,
        voiceChannelId,
      });
      return;
    }
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ content, allowedMentions });
  await api.recordDiscordState(item.runId, {
    kind: "start",
    channelId: message.channelId,
    messageId: message.id,
    voiceChannelId,
  });
}

/**
 * Apex-style Raid Invite DM (legacy lane). Always records the signup id after
 * an attempt (including closed-DM failures) so the bot does not retry forever.
 */
async function syncRaidInvite(
  client: Client,
  api: BotApiClient,
  item: RaidInviteLaneItem,
): Promise<void> {
  const content = buildRaidInviteMessage({
    productLabel: item.productLabel,
    scheduledStartAt: item.scheduledStartAt,
    difficulty: item.difficulty,
    lootType: item.lootType,
    participationType: item.participationType,
    selectedRole: item.selectedRole,
    characterName: item.characterName,
    wowClass: item.wowClass,
    runChannelId: item.runChannelId,
    // Legacy lane (listSyncWork always returns [] for it) — no voice link.
    voiceChannelId: null,
  });

  try {
    const user = await client.users.fetch(item.discordUserId);
    await user.send({ content });
  } catch (error) {
    if (isDiscordCannotDmError(error) || isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] cannot DM raid invite to ${item.discordUserId} for signup ${item.signupId} — marking sent to avoid retry loop`,
        error,
      );
    } else {
      throw error;
    }
  }

  await api.recordDiscordState(item.runId, { kind: "raid-invite", signupId: item.signupId });
}

/**
 * UserNotification Discord DM lane. PENDING rows only — SENT / FAILED_PERMANENT /
 * SKIPPED never appear in sync work. Transient Discord errors leave PENDING.
 */
async function syncNotificationDm(
  client: Client,
  api: BotApiClient,
  item: NotificationDmLaneItem,
  resolvedVoiceChannels: ResolvedVoiceChannels,
): Promise<void> {
  let content: string;
  switch (item.type) {
    case "ROSTER_SELECTED":
      content = buildRosterSelectedDmMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
        assignment: {
          participationType: item.participationType ?? "BOOSTER",
          publishedRole: item.selectedRole,
          characterName: item.characterName,
          characterRealm: null,
          wowClass: item.wowClass,
        },
        runChannelId: item.runChannelId,
        update: item.rosterUpdate === true,
      });
      break;
    case "RAID_INVITE":
      content = buildRaidInviteMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
        participationType: item.participationType ?? "BOOSTER",
        selectedRole: item.selectedRole,
        characterName: item.characterName,
        wowClass: item.wowClass,
        runChannelId: item.runChannelId,
        // This pass's voice outcome wins over the projection taken before it
        // (just created → link it; deleted/gone this pass → omit it).
        voiceChannelId: effectiveVoiceChannelId(resolvedVoiceChannels, item.runId, item.voiceChannelId),
      });
      break;
    case "ROSTER_REMOVED":
      content = buildRosterRemovedDmMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
      });
      break;
    case "ROSTER_WITHDRAWN":
      if (!item.withdrawal) return;
      content = buildRosterWithdrawnDmMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
        ...item.withdrawal,
      });
      break;
    case "RUN_CANCELLED":
      content = buildRunCancelledDmMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
      });
      break;
    case "RUN_REACTIVATED":
      content = buildRunReactivatedDmMessage({
        productLabel: item.productLabel,
        scheduledStartAt: item.scheduledStartAt,
        difficulty: item.difficulty,
        lootType: item.lootType,
      });
      break;
    case "RUN_RESCHEDULED":
      content = buildRunRescheduledDmMessage({
        productLabel: item.productLabel,
        previousScheduledStartAt: item.previousScheduledStartAt ?? item.scheduledStartAt,
        nextScheduledStartAt: item.scheduledStartAt,
      });
      break;
    default:
      return;
  }

  try {
    const user = await client.users.fetch(item.discordUserId);
    // Stale in-memory CANCELLED DM must not send after Reactivate.
    let authority: { deliver: boolean };
    try {
      authority = await api.confirmNotificationDmDelivery(item.notificationId);
    } catch (error) {
      console.warn(
        `[discord-bot] notification DM authority unavailable for ${item.notificationId} — not sending (retry next pass)`,
        error,
      );
      return;
    }
    if (!authority.deliver) {
      console.warn(
        `[discord-bot] skipping notification DM ${item.notificationId}: delivery no longer authorized`,
      );
      return;
    }
    await user.send({ content });
    await api.recordDiscordState(item.runId, {
      kind: "notification-dm",
      notificationId: item.notificationId,
      result: "SENT",
    });
  } catch (error) {
    if (isDiscordCannotDmError(error) || isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] cannot DM notification ${item.notificationId} to ${item.discordUserId} — marking FAILED_PERMANENT`,
        error,
      );
      await api.recordDiscordState(item.runId, {
        kind: "notification-dm",
        notificationId: item.notificationId,
        result: "FAILED_PERMANENT",
      });
      return;
    }
    throw error;
  }
}

/**
 * Posts a durable Run-channel lifecycle announcement (reschedule / cancel).
 * Never creates a channel; never pings roles/members.
 * Unknown Channel / Missing Access → FAILED_PERMANENT (no infinite retry, no recreate).
 * No channel id → SKIPPED. Transient errors leave PENDING for a later pass.
 */
async function syncRunAnnouncement(
  client: Client,
  api: BotApiClient,
  item: RunAnnouncementLaneItem,
  resolvedChannels: Map<string, string>,
): Promise<void> {
  const runChannelId = resolvedChannels.get(item.runId) ?? item.runChannelId;
  if (!runChannelId) {
    // RUN_REACTIVATED after channel-gone: leave PENDING so a later pass (or
    // same-pass continuity recovery that already filled resolvedChannels)
    // can deliver once a replacement channel exists. Do not terminal-SKIP.
    if (item.type === "RUN_REACTIVATED") {
      console.warn(
        `[discord-bot] RUN_REACTIVATED ${item.announcementId} has no channel yet — leaving PENDING for continuity recovery`,
      );
      return;
    }
    await api.recordDiscordState(item.runId, {
      kind: "run-announcement",
      announcementId: item.announcementId,
      result: "SKIPPED",
    });
    return;
  }

  // Stale in-memory CANCELLED work must not post after Reactivate.
  let authority: { deliver: boolean };
  try {
    authority = await api.confirmRunAnnouncementDelivery(item.announcementId);
  } catch (error) {
    console.warn(
      `[discord-bot] announcement delivery authority unavailable for ${item.announcementId} — not sending (retry next pass)`,
      error,
    );
    return;
  }
  if (!authority.deliver) {
    console.warn(
      `[discord-bot] skipping announcement ${item.announcementId}: delivery no longer authorized`,
    );
    return;
  }

  const embed =
    item.type === "RUN_RESCHEDULED"
      ? buildRunRescheduledChannelEmbed({
          runId: item.runId,
          productLabel: item.productLabel,
          previousScheduledStartAt: item.previousScheduledStartAt ?? item.scheduledStartAt,
          scheduledStartAt: item.scheduledStartAt,
          difficulty: item.difficulty,
          lootType: item.lootType,
        })
      : item.type === "RUN_REACTIVATED"
        ? buildRunReactivatedChannelEmbed({
            runId: item.runId,
            productLabel: item.productLabel,
            scheduledStartAt: item.scheduledStartAt,
            difficulty: item.difficulty,
            lootType: item.lootType,
          })
        : buildRunCancelledChannelEmbed({
            runId: item.runId,
            productLabel: item.productLabel,
            scheduledStartAt: item.scheduledStartAt,
            difficulty: item.difficulty,
            lootType: item.lootType,
          });

  try {
    const channel = await client.channels.fetch(runChannelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      await api.recordDiscordState(item.runId, {
        kind: "run-announcement",
        announcementId: item.announcementId,
        result: "FAILED_PERMANENT",
      });
      return;
    }
    await (channel as TextChannel).send({ embeds: [embed] });
    await api.recordDiscordState(item.runId, {
      kind: "run-announcement",
      announcementId: item.announcementId,
      result: "SENT",
    });
  } catch (error) {
    if (isDiscordUnknownChannelError(error) || isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] cannot post announcement ${item.announcementId} to channel ${runChannelId} — marking FAILED_PERMANENT`,
        error,
      );
      await api.recordDiscordState(item.runId, {
        kind: "run-announcement",
        announcementId: item.announcementId,
        result: "FAILED_PERMANENT",
      });
      return;
    }
    throw error;
  }
}

async function syncSchedulePosts(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  items: NonNullable<SyncWork["schedules"]>,
): Promise<void> {
  for (const item of items) {
    try {
      const markerChannelId =
        item.bucket === "CURRENT"
          ? env.discordRunCurrentMarkerChannelId
          : env.discordRunNextMarkerChannelId;
      if (!markerChannelId) {
        console.warn(
          `[discord-bot] schedule ${item.bucket}: marker channel unset — skipping Schedule sync`,
        );
        continue;
      }

      const payload = { embeds: [item.embed] };
      const storedMessageId = item.existingMessageId;
      const storedChannelId = item.existingChannelId;
      const inConfiguredMarker =
        Boolean(storedMessageId) && storedChannelId === markerChannelId;
      // Server signature is env-agnostic; marker id lives only in bot env, so a
      // configured-marker change must wake reconciliation even when content is settled.
      const mustReconcile =
        item.needsUpdate || !storedMessageId || storedChannelId !== markerChannelId;

      if (!mustReconcile && inConfiguredMarker && storedMessageId) {
        // Converged content: still confirm the canonical message exists.
        const probe = await probeScheduleMessage(client, markerChannelId, storedMessageId);
        if (probe === "exists") continue;
        if (probe === "transient") {
          console.warn(
            `[discord-bot] schedule ${item.bucket}: cannot verify stored message ${storedMessageId} — keeping identity, retry next poll`,
          );
          continue;
        }
        // Confirmed Unknown Message (10008) → one replacement below.
        await createAndRecordScheduleMessage({
          client,
          api,
          bucket: item.bucket,
          markerChannelId,
          payload,
          signature: item.desiredSignature,
        });
        continue;
      }

      if (inConfiguredMarker && storedMessageId && item.needsUpdate) {
        const edited = await editScheduleMessage(client, markerChannelId, storedMessageId, payload);
        if (edited === "edited") {
          await api.recordScheduleState({
            bucket: item.bucket,
            channelId: markerChannelId,
            messageId: storedMessageId,
            signature: item.desiredSignature,
          });
          continue;
        }
        if (edited === "transient") {
          console.warn(
            `[discord-bot] schedule ${item.bucket}: edit of ${storedMessageId} failed transiently — keeping identity, retry next poll`,
          );
          continue;
        }
        // Confirmed Unknown Message → one replacement below.
        await createAndRecordScheduleMessage({
          client,
          api,
          bucket: item.bucket,
          markerChannelId,
          payload,
          signature: item.desiredSignature,
        });
        continue;
      }

      // First create, or marker-channel env change: post into the configured marker.
      const created = await createAndRecordScheduleMessage({
        client,
        api,
        bucket: item.bucket,
        markerChannelId,
        payload,
        signature: item.desiredSignature,
      });
      if (
        created &&
        storedMessageId &&
        storedChannelId &&
        storedChannelId !== markerChannelId
      ) {
        // Best-effort only, after the new identity is recorded — exact old ids, no scan.
        await bestEffortDeleteScheduleMessage(
          client,
          storedChannelId,
          storedMessageId,
          item.bucket,
        );
      }
    } catch (error) {
      console.error(`[discord-bot] schedule ${item.bucket} sync failed`, error);
    }
  }
}

type ScheduleMessageOutcome = "exists" | "unknown" | "transient";
type ScheduleEditOutcome = "edited" | "unknown" | "transient";

async function probeScheduleMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<ScheduleMessageOutcome> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) return "transient";
    await channel.messages.fetch(messageId);
    return "exists";
  } catch (error) {
    if (isDiscordUnknownMessageError(error)) return "unknown";
    return "transient";
  }
}

async function editScheduleMessage(
  client: Client,
  channelId: string,
  messageId: string,
  payload: MessageEditOptions,
): Promise<ScheduleEditOutcome> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) return "transient";
    const message = await channel.messages.fetch(messageId);
    await message.edit(payload);
    return "edited";
  } catch (error) {
    if (isDiscordUnknownMessageError(error)) return "unknown";
    return "transient";
  }
}

async function createAndRecordScheduleMessage(input: {
  client: Client;
  api: BotApiClient;
  bucket: "CURRENT" | "NEXT";
  markerChannelId: string;
  payload: { embeds: Array<{ title: string; description: string; color: number }> };
  signature: string;
}): Promise<boolean> {
  const channel = await input.client.channels.fetch(input.markerChannelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    console.warn(
      `[discord-bot] schedule ${input.bucket}: marker channel ${input.markerChannelId} is not text-based`,
    );
    return false;
  }
  const sent = await channel.send(input.payload);
  // Best-effort pin on create/replacement — never fail Schedule sync.
  if (typeof sent.pin === "function") {
    try {
      await sent.pin();
    } catch (error) {
      console.warn(`[discord-bot] schedule ${input.bucket}: pin failed (ignored)`, error);
    }
  }
  await input.api.recordScheduleState({
    bucket: input.bucket,
    channelId: input.markerChannelId,
    messageId: sent.id,
    signature: input.signature,
  });
  console.log(`[discord-bot] schedule ${input.bucket}: created message in marker channel`);
  return true;
}

/** Exact stored identity only — never scan; failures never undo the new post. */
async function bestEffortDeleteScheduleMessage(
  client: Client,
  channelId: string,
  messageId: string,
  bucket: "CURRENT" | "NEXT",
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) return;
    const message = await channel.messages.fetch(messageId);
    if (typeof message.delete === "function") {
      await message.delete();
    }
  } catch (error) {
    console.warn(
      `[discord-bot] schedule ${bucket}: old marker message cleanup failed (ignored)`,
      error,
    );
  }
}

async function tryEditMessage(
  client: Client,
  channelId: string,
  messageId: string,
  payload: MessageEditOptions,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) return false;
    const message = await channel.messages.fetch(messageId);
    await message.edit(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Channel retirement after **explicit app archive** (`Run.archivedAt`):
 * never moves the Run channel into an archive category. Builds the HTML
 * transcript for website download and (when not already posted) sends
 * Ticket-Tool-style artifacts into `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID`:
 * (1) Server-Info text + `transcript-{name}.html` attachment,
 * (2) green details embed + Direct Link button.
 * When Discord message ids already exist, skips re-send and only persists HTML.
 * After the transcript is safely recorded, re-checks `archivedAt` and deletes
 * the Run's Discord TEXT channel (the Manawyrm Hub Run row itself is kept as
 * an archived Run). Records `channel-gone` for that exact channel id.
 *
 * COMPLETED / CANCELLED without app archive never enter this path
 * (`retireChannel` is false). Schedule-based PAST/FUTURE ARCHIVE holding is
 * unchanged (silent category move, no delete).
 *
 * Partial failure: if the details embed fails after the transcript attachment
 * was posted, we still persist transcript message id + HTML (durable archive
 * authority) and proceed to delete when `archivedAt` remains set — the embed
 * is presentation for the log channel, not the archival record itself.
 */
async function syncArchiveArtifacts(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelLaneItem,
  resolvedChannels: Map<string, string>,
): Promise<void> {
  if (!item.retireChannel) return;

  // Stale CANCELLED work must not destroy a channel after Reactivate.
  const retirement = await api.confirmChannelRetirement(item.runId);
  if (!retirement.retire) {
    console.warn(
      `[discord-bot] skipping retirement of run ${item.runId}: current authority no longer allows channel retirement`,
    );
    return;
  }

  const runChannelId = resolvedChannels.get(item.runId) ?? item.existingRunChannelId;
  if (!runChannelId) return;

  const alreadyPosted = Boolean(item.archiveCloseMessageId && item.archiveTranscriptMessageId);

  // Artifacts already complete: only delete any leftover Run channel.
  if (!item.archiveArtifactsNeeded) {
    await deleteArchivedRunChannel(client, api, item.runId, runChannelId);
    return;
  }

  if (!alreadyPosted && !env.discordRunArchiveLogChannelId) {
    console.warn(
      `[discord-bot] DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID unset — skipping archive log for run ${item.runId}`,
    );
    return;
  }

  let runChannel;
  try {
    runChannel = await client.channels.fetch(runChannelId);
  } catch (error) {
    if (isDiscordUnknownChannelError(error)) {
      // Confirmed gone: drop every identity stored for exactly this channel.
      console.warn(
        `[discord-bot] run ${item.runId} channel ${runChannelId} is gone in Discord (Unknown Channel) — recording channel-gone`,
      );
      await recordRetiredChannelGone(api, item.runId, runChannelId);
      return;
    }
    if (isDiscordPermissionError(error)) {
      // The channel may still exist — keep its identity and retry next pass.
      console.warn(
        `[discord-bot] cannot read run channel ${runChannelId} for archive transcript on run ${item.runId} (missing access/permission) — keeping stored identity`,
        error,
      );
      return;
    }
    throw error;
  }

  if (!runChannel || !runChannel.isTextBased() || !("messages" in runChannel)) {
    // It exists (or did not resolve) but is not a usable text channel — never
    // claim it is deleted; keep the identity for an operator to look at.
    console.warn(
      `[discord-bot] run ${item.runId} channel ${runChannelId} is not a usable text channel — keeping stored identity`,
    );
    return;
  }

  let messages: TranscriptMessage[];
  let messageContent: MessageContentStatus;
  try {
    // Text Discord withholds (no Message Content access) is recorded as
    // unavailable; the archive never waits for access that may never come.
    ({ messages, messageContent } = await fetchChannelTranscript(runChannel as TextChannel, {
      appUserId: client.user?.id ?? null,
      messageContent: getMessageContentStatus(),
    }));
  } catch (error) {
    if (isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] missing Read Message History for archive transcript on run ${item.runId} — skipping`,
        error,
      );
      return;
    }
    throw error;
  }

  const guild = await client.guilds.fetch(env.discordGuildId);
  const channelName = item.desiredChannelName;
  const html = buildArchiveTranscriptHtml({
    serverName: guild.name,
    serverId: guild.id,
    channelName,
    channelId: runChannelId,
    runId: item.runId,
    messages,
    messageContent: messageContent.capability,
  });
  const contentSummary = transcriptMessageContent(messages, messageContent.capability);
  if (contentSummary.unavailable > 0) {
    console.warn(
      `[discord-bot] run ${item.runId} transcript: text of ${contentSummary.unavailable} message(s) withheld by Discord (Message Content access unavailable) — archived as "content unavailable"`,
    );
  }
  const filename = buildArchiveTranscriptFilename(channelName);

  if (alreadyPosted) {
    await api.recordDiscordState(item.runId, {
      kind: "archive-artifacts",
      closeMessageId: item.archiveCloseMessageId!,
      transcriptMessageId: item.archiveTranscriptMessageId!,
      transcriptHtml: html,
      transcriptFilename: filename,
    });
    await deleteArchivedRunChannel(client, api, item.runId, runChannelId);
    return;
  }

  let logChannel;
  try {
    logChannel = await client.channels.fetch(env.discordRunArchiveLogChannelId!);
  } catch (error) {
    if (isDiscordPermissionError(error) || isDiscordUnknownChannelError(error)) {
      console.warn(
        `[discord-bot] cannot fetch archive log channel ${env.discordRunArchiveLogChannelId} for run ${item.runId} — skipping`,
        error,
      );
      return;
    }
    throw error;
  }

  if (!logChannel || !logChannel.isTextBased() || !("send" in logChannel)) {
    console.warn(
      `[discord-bot] archive log channel ${env.discordRunArchiveLogChannelId} is not a text channel — skipping`,
    );
    return;
  }

  const serverInfo = buildArchiveServerInfoContent({
    serverName: guild.name,
    serverId: guild.id,
    channelName,
    channelId: runChannelId,
    messageCount: messages.length,
    messageContent: contentSummary.state,
  });
  const file = new AttachmentBuilder(Buffer.from(html, "utf8"), { name: filename });

  let transcriptMessage;
  try {
    transcriptMessage = await (logChannel as TextChannel).send({
      content: serverInfo,
      files: [file],
    });
  } catch (error) {
    if (isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] missing Send Messages / Attach Files on archive log channel for run ${item.runId} — skipping`,
        error,
      );
      return;
    }
    throw error;
  }

  const attachmentUrl = transcriptMessage.attachments.first()?.url ?? null;
  const users = summarizeTranscriptUsers(messages);
  const usersBlock =
    users.length === 0
      ? "_none_"
      : users
          .slice(0, 25)
          .map((user) => `${user.messageCount} - <@${user.authorId}> - ${user.tag}`)
          .join("\n");

  const ticketOwner = item.raidLeadDiscordUserId
    ? `<@${item.raidLeadDiscordUserId}>`
    : item.raidLeadName || "Unknown";

  const detailsEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .addFields(
      { name: "Ticket Owner", value: ticketOwner, inline: true },
      { name: "Ticket Name", value: channelName.slice(0, 256) || "—", inline: true },
      { name: "Panel Name", value: (item.panelName || "Manawyrm Hub Run").slice(0, 256), inline: true },
      { name: "Direct Transcript", value: attachmentUrl ? "Use Button" : "Attachment unavailable", inline: false },
      { name: "Users in transcript", value: usersBlock.slice(0, 1024), inline: false },
    );

  const components = attachmentUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Direct Link").setURL(attachmentUrl).setEmoji("📎"),
        ),
      ]
    : [];

  let detailsMessage;
  try {
    detailsMessage = await (logChannel as TextChannel).send({
      embeds: [detailsEmbed],
      components,
    });
  } catch (error) {
    if (isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] failed to post archive details embed for run ${item.runId} — transcript message already sent`,
        error,
      );
      // Still record HTML + transcript message so we do not re-attach forever.
      await api.recordDiscordState(item.runId, {
        kind: "archive-artifacts",
        closeMessageId: transcriptMessage.id,
        transcriptMessageId: transcriptMessage.id,
        transcriptHtml: html,
        transcriptFilename: filename,
      });
      await deleteArchivedRunChannel(client, api, item.runId, runChannelId);
      return;
    }
    throw error;
  }

  await api.recordDiscordState(item.runId, {
    kind: "archive-artifacts",
    closeMessageId: detailsMessage.id,
    transcriptMessageId: transcriptMessage.id,
    transcriptHtml: html,
    transcriptFilename: filename,
  });
  await deleteArchivedRunChannel(client, api, item.runId, runChannelId);
}

/** Deletes an app-archived Run TEXT channel after the transcript is recorded. */
async function deleteArchivedRunChannel(
  client: Client,
  api: BotApiClient,
  runId: string,
  channelId: string,
): Promise<void> {
  // Final authority check immediately before irreversible delete.
  const retirement = await api.confirmChannelRetirement(runId);
  if (!retirement.retire) {
    console.warn(
      `[discord-bot] refusing to delete channel ${channelId} for run ${runId}: retirement no longer allowed`,
    );
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("delete" in channel) || typeof channel.delete !== "function") {
      // Not confirmed deleted — keep the identity rather than orphan a live channel.
      console.warn(
        `[discord-bot] archived run channel ${channelId} for run ${runId} cannot be deleted by the bot (not a deletable channel) — keeping stored identity`,
      );
      return;
    }
    await channel.delete(`Manawyrm Hub app-archive — transcript retained for run ${runId}`);
  } catch (error) {
    if (isDiscordUnknownChannelError(error)) {
      // Already gone — confirmed, so converge the stored identity below.
    } else if (isDiscordPermissionError(error)) {
      // The channel may still exist: clearing its id would orphan it. Retry next pass.
      console.warn(
        `[discord-bot] missing permission to delete archived run channel ${channelId} for run ${runId} — keeping stored identity`,
        error,
      );
      return;
    } else {
      console.error(`[discord-bot] failed to delete archived run channel ${channelId} for run ${runId}`, error);
      // Do not clear the id — retry delete next poll.
      return;
    }
  }

  await recordRetiredChannelGone(api, runId, channelId);
}

/**
 * A retired Run channel is confirmed deleted (we deleted it, or Discord says
 * Unknown Channel). `channel-gone` clears every identity that still points at
 * exactly this channel id — Run channel, signup post, roster post — with a
 * compare-and-set per field group, so a replacement channel or a different
 * (shared) signup channel is never touched. `clear-channel` would drop only
 * runChannelId and leave the signup/roster identity of the deleted channel
 * behind forever.
 */
async function recordRetiredChannelGone(api: BotApiClient, runId: string, channelId: string): Promise<void> {
  try {
    await api.recordDiscordState(runId, { kind: "channel-gone", channelId });
  } catch (error) {
    console.error(`[discord-bot] failed to record deleted channel ${channelId} for run ${runId}`, error);
  }
}

/**
 * One page of Run channel history as plain data for the Warcraft Logs link
 * scan: the newest page, or the page right after `after` (REST history read —
 * same access as the archive transcript; `cache: false` so every page is a
 * real read).
 */
async function fetchScannableMessagePage(
  client: Client,
  channelId: string,
  options: { after?: string; limit: number },
): Promise<ScannableMessage[]> {
  const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId));
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return [];
  const batch = await (channel as TextChannel).messages.fetch({
    limit: options.limit,
    ...(options.after ? { after: options.after } : {}),
    cache: false,
  });
  return [...batch.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => ({
      id: message.id,
      authorId: message.author.id,
      content: message.content ?? "",
      embeds: message.embeds.map((embed) => ({
        title: embed.title,
        description: embed.description,
        url: embed.url,
        fields: embed.fields.map((field) => ({ name: field.name, value: field.value })),
      })),
    }));
}
