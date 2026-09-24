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
} from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { isDiscordUnknownChannelError, isDiscordCannotDmError } from "@/discord-bot/discord-api-errors";
import {
  ARCHIVE_TRANSCRIPT_MESSAGE_CAP,
  buildArchiveServerInfoContent,
  buildArchiveTranscriptFilename,
  buildArchiveTranscriptHtml,
  summarizeTranscriptUsers,
  type TranscriptMessage,
} from "@/discord-bot/archive-transcript";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import {
  buildRaidboostAnnounce,
  RAIDBOOST_ANNOUNCE_EMOJI_NAME,
  RAIDBOOST_PING_ROLE_NAMES,
} from "@/discord-bot/embeds/raidboost-announce";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import {
  resolveGuildClassIndicators,
  resolveGuildRoleIndicators,
  fingerprintClassIndicators,
  fingerprintRoleIndicators,
  type GuildRoleIndicators,
} from "@/discord-bot/class-emoji-lookup";
import { buildRaidInviteMessage } from "@/discord-bot/messages/raid-invite-message";
import {
  buildRunCancelledChannelEmbed,
  buildRunRescheduledChannelEmbed,
} from "@/discord-bot/embeds/run-lifecycle-announcement";
import { buildRosterSelectedDmMessage, buildRosterRemovedDmMessage, buildRunCancelledDmMessage, buildRunRescheduledDmMessage } from "@/services/notification-content";
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
 * or null if Discord confirmed it is gone (Unknown Channel). Cache-first
 * (`client.channels.cache`) to avoid an unnecessary REST call on every poll;
 * falls back to `fetch` on a cache miss. Permission / rate-limit / network
 * failures are rethrown so callers do not treat a live but inaccessible
 * channel as deleted.
 */
function makeChannelFetcher(client: Client): ChannelFetcher {
  return async (channelId) => {
    try {
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
    } catch (error) {
      if (isDiscordUnknownChannelError(error)) return null;
      throw error;
    }
  };
}

function mapCategoryChildren(
  channels: Iterable<{ id: string; position?: number; parentId?: string | null }>,
  categoryId: string | null,
): Array<{ id: string; position: number }> {
  return [...channels]
    .filter((channel) => {
      if (categoryId === null) return true;
      return "parentId" in channel && channel.parentId === categoryId;
    })
    .map((channel) => ({
      id: channel.id,
      position: typeof channel.position === "number" ? channel.position : 0,
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
  const classIndicators = await resolveGuildClassIndicators(client, env.discordGuildId);
  const roleIndicators = await resolveGuildRoleIndicators(client, env.discordGuildId);
  const classEmojiFingerprint = [
    fingerprintClassIndicators(classIndicators),
    fingerprintRoleIndicators(roleIndicators),
  ].join("||");
  const work: SyncWork = await api.listSyncWork(classEmojiFingerprint);

  // Channel reconciliation (name + parent category) runs first and
  // independently of message state — a Run's channel should already be in
  // its correct place before any new signup/roster message work is applied.
  // The resulting map lets the message paths below reuse the same resolved
  // channel instead of re-resolving (and potentially re-renaming/re-moving)
  // it a second time within the same pass.
  const resolvedChannels = await reconcileChannels(
    makeChannelFetcher(client),
    { discordRunCategoryId: env.discordRunCategoryId, discordRunArchiveCategoryId: env.discordRunArchiveCategoryId },
    work.channels,
  );

  // Lifecycle channel announcements must post before retirement transcript/delete
  // so CANCELLED messages appear in the final transcript.
  if ((work.runAnnouncements ?? []).length > 0) {
    for (const item of work.runAnnouncements ?? []) {
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
    try {
      await syncArchiveArtifacts(client, env, api, item, resolvedChannels);
    } catch (error) {
      console.error(`[discord-bot] archive artifacts failed for run ${item.runId}`, error);
    }
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
        await syncRosterPost(client, env, api, item, data, resolvedChannels, classIndicators, roleIndicators);
      } catch (error) {
        console.error(`[discord-bot] roster sync failed for run ${item.runId}`, error);
        messagePhaseError ??= error;
      }
    }

    for (const item of work.start ?? []) {
      try {
        const data = (await api.getRunStartEmbedData(item.runId).catch(() => null)) as RunStartEmbedData | null;
        if (!data) continue;
        await syncStartPost(client, env, api, item, data, resolvedChannels, classIndicators);
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
          await syncNotificationDm(client, api, item);
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

  if (item.existingRunChannelId) {
    const reconciled = resolvedChannels.get(item.runId);
    if (reconciled) return { channelId: reconciled, created: false };

    // Not reconciled this pass — defensive only; every Run with a persisted
    // runChannelId is always included in work.channels, so this should
    // never actually be reached. Just verify the id still resolves; name
    // and category reconciliation are reconcileChannels' job, never
    // repeated here, so the same channel is never renamed/moved twice in
    // one pass.
    try {
      const existing = await client.channels.fetch(item.existingRunChannelId);
      if (existing) return { channelId: item.existingRunChannelId, created: false };
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
    // Only first provisioning for an open CURRENT/NEXT signup window may
    // create a channel. Continuity edits (CANCELLED/COMPLETED after archive
    // cleared runChannelId) must not recreate — that re-fires role pings.
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
  return { channelId: created.id, created: true };
}

async function syncSignupPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: SignupLaneItem,
  data: SignupEmbedData,
  resolvedChannels: Map<string, string>,
  classIndicators: Awaited<ReturnType<typeof resolveGuildClassIndicators>>,
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
    if (created) {
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
  classIndicators: Awaited<ReturnType<typeof resolveGuildClassIndicators>>,
  roleIndicators: GuildRoleIndicators,
): Promise<void> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false, resolvedChannels);
  if (!resolved) return;
  const { channelId } = resolved;

  const embed = buildRosterEmbed(data, { classIndicators, roleIndicators });

  if (item.existingMessageId) {
    const edited = await tryEditMessage(client, channelId, item.existingMessageId, { embeds: [embed] });
    if (edited) {
      await api.recordDiscordState(item.runId, { kind: "roster", channelId, messageId: item.existingMessageId });
      return;
    }
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ embeds: [embed] });
  await api.recordDiscordState(item.runId, { kind: "roster", channelId: message.channelId, messageId: message.id });
}

async function syncStartPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: StartLaneItem,
  data: RunStartEmbedData,
  resolvedChannels: Map<string, string>,
  classIndicators: Awaited<ReturnType<typeof resolveGuildClassIndicators>>,
): Promise<void> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false, resolvedChannels);
  if (!resolved) return;
  const { channelId } = resolved;

  const content = renderRunStartMessageText(data, { classIndicators });
  // Same explicit policy for send and edit: only selected roster users may be pinged.
  const allowedMentions = finalSetupAllowedMentions(data);
  const editPayload: MessageEditOptions = { content, embeds: [], allowedMentions };

  if (item.existingMessageId) {
    const edited = await tryEditMessage(client, channelId, item.existingMessageId, editPayload);
    if (edited) {
      await api.recordDiscordState(item.runId, { kind: "start", channelId, messageId: item.existingMessageId });
      return;
    }
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ content, allowedMentions });
  await api.recordDiscordState(item.runId, { kind: "start", channelId: message.channelId, messageId: message.id });
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
    case "RUN_CANCELLED":
      content = buildRunCancelledDmMessage({
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
    await api.recordDiscordState(item.runId, {
      kind: "run-announcement",
      announcementId: item.announcementId,
      result: "SKIPPED",
    });
    return;
  }

  const embed =
    item.type === "RUN_RESCHEDULED"
      ? buildRunRescheduledChannelEmbed({
          productLabel: item.productLabel,
          previousScheduledStartAt: item.previousScheduledStartAt ?? item.scheduledStartAt,
          scheduledStartAt: item.scheduledStartAt,
          difficulty: item.difficulty,
          lootType: item.lootType,
        })
      : buildRunCancelledChannelEmbed({
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

function isDiscordPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  // 50001 Missing Access, 50013 Missing Permissions
  return code === 50001 || code === 50013 || code === "50001" || code === "50013";
}

async function fetchMessagesForTranscript(
  channel: TextChannel,
  cap = ARCHIVE_TRANSCRIPT_MESSAGE_CAP,
): Promise<TranscriptMessage[]> {
  const collected: Array<{
    id: string;
    createdTimestamp: number;
    author: {
      id: string;
      displayName?: string | null;
      username?: string | null;
      discriminator?: string | null;
    };
    content: string;
    embeds: Array<{ title?: string | null; description?: string | null }>;
  }> = [];
  let before: string | undefined;

  while (collected.length < cap) {
    const limit = Math.min(100, cap - collected.length);
    const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    for (const message of batch.values()) {
      collected.push({
        id: message.id,
        createdTimestamp: message.createdTimestamp,
        author: {
          id: message.author.id,
          displayName: "displayName" in message.author ? (message.author as { displayName?: string }).displayName : null,
          username: message.author.username,
          discriminator: message.author.discriminator,
        },
        content: message.content ?? "",
        embeds: message.embeds.map((embed) => ({
          title: embed.title ?? null,
          description: embed.description ?? null,
        })),
      });
    }
    const oldest = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    before = oldest?.id;
    if (batch.size < limit) break;
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return collected.slice(0, cap).map((message) => ({
    id: message.id,
    createdAt: new Date(message.createdTimestamp).toISOString(),
    authorDisplayName: message.author.displayName || message.author.username || "Unknown",
    authorUsername: message.author.username || "unknown",
    authorDiscriminator: message.author.discriminator || "0",
    authorId: message.author.id,
    content: message.content,
    embeds: message.embeds,
  }));
}

/**
 * Channel retirement (app-archive, COMPLETED, or CANCELLED): never moves the
 * Run channel into an archive category. Builds the HTML transcript for website
 * download and (when not already posted) sends Ticket-Tool-style artifacts into
 * `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID`:
 * (1) Server-Info text + `transcript-{name}.html` attachment,
 * (2) green details embed + Direct Link button.
 * When Discord message ids already exist, skips re-send and only persists HTML.
 * After the transcript is safely recorded, deletes the Run's Discord channel
 * and clears `runChannelId` — the lasting record is the transcript alone.
 * Schedule-based PAST/FUTURE ARCHIVE holding is unchanged (silent move, no
 * delete) and never enters this path (`retireChannel` is false).
 */
async function syncArchiveArtifacts(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelLaneItem,
  resolvedChannels: Map<string, string>,
): Promise<void> {
  if (!item.retireChannel) return;

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
    if (isDiscordPermissionError(error) || isDiscordUnknownChannelError(error)) {
      console.warn(
        `[discord-bot] cannot fetch run channel ${runChannelId} for archive transcript on run ${item.runId} — clearing stored id`,
        error,
      );
      await api.recordDiscordState(item.runId, { kind: "clear-channel" });
      return;
    }
    throw error;
  }

  if (!runChannel || !runChannel.isTextBased() || !("messages" in runChannel)) {
    console.warn(`[discord-bot] run ${item.runId} channel ${runChannelId} is not a text channel — clearing stored id`);
    await api.recordDiscordState(item.runId, { kind: "clear-channel" });
    return;
  }

  let messages: TranscriptMessage[];
  try {
    messages = await fetchMessagesForTranscript(runChannel as TextChannel);
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
  });
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
      { name: "Panel Name", value: (item.panelName || "BoostingHub Run").slice(0, 256), inline: true },
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

/** Deletes an app-archived Run channel after the transcript is recorded. */
async function deleteArchivedRunChannel(
  client: Client,
  api: BotApiClient,
  runId: string,
  channelId: string,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "delete" in channel && typeof channel.delete === "function") {
      await channel.delete(`BoostingHub app-archive — transcript retained for run ${runId}`);
    }
  } catch (error) {
    if (isDiscordUnknownChannelError(error)) {
      // Already gone — still clear the stored id below.
    } else if (isDiscordPermissionError(error)) {
      console.warn(
        `[discord-bot] missing permission to delete archived run channel ${channelId} for run ${runId} — clearing stored id anyway`,
        error,
      );
    } else {
      console.error(`[discord-bot] failed to delete archived run channel ${channelId} for run ${runId}`, error);
      // Do not clear the id — retry delete next poll.
      return;
    }
  }

  try {
    await api.recordDiscordState(runId, { kind: "clear-channel" });
  } catch (error) {
    console.error(`[discord-bot] failed to clear runChannelId after deleting channel for run ${runId}`, error);
  }
}
