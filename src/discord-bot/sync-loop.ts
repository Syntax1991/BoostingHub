import { ChannelType, type CategoryChannel, type Client, type MessageEditOptions } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
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
import type { RosterEmbedData, SignupEmbedData } from "@/services/discord-sync.service";

type SyncWork = Awaited<ReturnType<BotApiClient["listSyncWork"]>>;
type ChannelWorkItem = {
  runId: string;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
  scheduledStartAt?: string;
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
 */
export function startSyncLoop(client: Client, env: BotEnv, api: BotApiClient): NodeJS.Timeout {
  const runOnce = () => {
    void syncOnce(client, env, api).catch((error) => {
      console.error("[discord-bot] sync pass failed", error);
    });
  };
  runOnce();
  return setInterval(runOnce, env.syncIntervalMs);
}

/**
 * Resolves a channel id to the narrow shape channel-reconciliation.ts needs,
 * or null if it doesn't resolve to a compatible (settable name/parent)
 * Discord channel. Cache-first (`client.channels.cache`) to avoid an
 * unnecessary REST call on every poll; falls back to `fetch` on a cache miss.
 */
function makeChannelFetcher(client: Client): ChannelFetcher {
  return async (channelId) => {
    const cached = client.channels.cache.get(channelId);
    const channel = cached ?? (await client.channels.fetch(channelId).catch(() => null));
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
  const work: SyncWork = await api.listSyncWork();

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
        await syncRosterPost(client, env, api, item, data, resolvedChannels);
      } catch (error) {
        console.error(`[discord-bot] roster sync failed for run ${item.runId}`, error);
        messagePhaseError ??= error;
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
 * failing that, whether the stored id still resolves at all (if the channel
 * was deleted out-of-band in Discord, a fresh one is created only when
 * `allowCreate` is true — self-healing, not the bot deleting anything).
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
  item: ChannelWorkItem,
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
    const existing = await client.channels.fetch(item.existingRunChannelId).catch(() => null);
    if (existing) return { channelId: item.existingRunChannelId, created: false };
    // Stored channel id no longer resolves (deleted in Discord) — fall through.
  }

  if (!allowCreate) {
    // Only the signup path may provision a Run's first channel (it alone is
    // gated by isSignupWindowOpen + week bucket). A roster-only sync pass for
    // a Run that never went through a bot-observed signup phase — e.g.
    // historical data predating the bot, or the bot being offline through
    // the entire signup window — must not retroactively create Discord
    // infrastructure for it.
    console.warn(`[discord-bot] run ${item.runId} has no channel and none may be created from the roster path — skipping`);
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
  item: ChannelWorkItem & { existingMessageId: string | null; scheduledStartAt: string },
  data: SignupEmbedData,
  resolvedChannels: Map<string, string>,
): Promise<WeekSectionItem | null> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordSignupChannelId, true, resolvedChannels);
  if (!resolved) return null;
  const { channelId, created } = resolved;
  // Capture same-pass ordering metadata before message work — send/edit/
  // recordDiscordState failures must not erase the fact that a CURRENT/NEXT
  // channel was provisioned and needs immediate section placement.
  const section = createdSectionItem(item, channelId, created);

  try {
    const embed = buildSignupEmbed(data);
    const row = buildSignupButtons(data);

    if (item.existingMessageId) {
      const edited = await tryEditMessage(client, channelId, item.existingMessageId, {
        embeds: [embed],
        components: [row],
      });
      if (edited) {
        await api.recordDiscordState(data.runId, { kind: "signup", channelId, messageId: item.existingMessageId });
        return section;
      }
      // The stored message is gone (deleted in Discord) — fall through and repost.
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      return section;
    }
    const message = await channel.send({ embeds: [embed], components: [row] });
    await api.recordDiscordState(data.runId, { kind: "signup", channelId: message.channelId, messageId: message.id });
  } catch (error) {
    // Channel identity is already persisted; message work retries next poll.
    // Still return `section` so same-pass CURRENT/NEXT positioning includes
    // this newly created channel.
    console.error(`[discord-bot] signup message sync failed for run ${item.runId} (channel ${channelId})`, error);
  }
  return section;
}

function createdSectionItem(
  item: ChannelWorkItem & { scheduledStartAt: string },
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

async function syncRosterPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelWorkItem & { existingMessageId: string | null },
  data: RosterEmbedData,
  resolvedChannels: Map<string, string>,
): Promise<void> {
  const resolved = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false, resolvedChannels);
  if (!resolved) return;
  const { channelId } = resolved;

  const embed = buildRosterEmbed(data);

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
