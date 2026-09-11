import { ChannelType, type CategoryChannel, type Client, type MessageEditOptions } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import type { RosterEmbedData, SignupEmbedData } from "@/services/discord-sync.service";

type SyncWork = Awaited<ReturnType<BotApiClient["listSyncWork"]>>;
type ChannelWorkItem = {
  runId: string;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  archived: boolean;
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

async function syncOnce(client: Client, env: BotEnv, api: BotApiClient): Promise<void> {
  const work: SyncWork = await api.listSyncWork();

  for (const item of work.signups) {
    if (!item.embed) continue;
    await syncSignupPost(client, env, api, item, item.embed as SignupEmbedData);
  }

  for (const item of work.roster) {
    const data = (await api.getRosterEmbedData(item.runId).catch(() => null)) as RosterEmbedData | null;
    if (!data) continue;
    await syncRosterPost(client, env, api, item, data);
  }
}

/**
 * Resolves the Discord channel a Run's posts belong in.
 *
 * Preferred (per-Run) mode — `DISCORD_RUN_CATEGORY_ID` configured: creates
 * the Run's own dedicated text channel once (recorded immediately via the
 * "channel" discord-state kind, before any message is posted) and renames
 * that same channel in place whenever the desired name drifts (schedule,
 * difficulty, or raid lead changed) — it never creates a replacement, and
 * the persisted channel id is the only identity that matters (never the
 * name). If the stored channel was deleted out-of-band in Discord, a fresh
 * one is created only when `allowCreate` is true — self-healing, not the
 * bot deleting anything.
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
 * in `listSyncWork` — may create a Run's first channel; the roster path may
 * only reuse one that already exists.
 *
 * Legacy mode — no category configured: always the single global channel
 * from env (`DISCORD_SIGNUP_CHANNEL_ID` / `DISCORD_ROSTER_CHANNEL_ID`).
 *
 * Archive movement: an existing channel whose parent doesn't match the
 * Run's current archived state (`item.archived`) is moved — never
 * recreated, never renamed for this reason alone, never deleted. This is
 * the only effect Archive/Restore has here; a Run without a channel never
 * gets one provisioned just because it was archived or restored.
 */
/**
 * Moves an already-resolved channel to whichever category its Run's current
 * archived state calls for — a no-op when it's already there. Skipped
 * (warning only, never an error) when the target category isn't configured,
 * so an unconfigured DISCORD_RUN_ARCHIVE_CATEGORY_ID degrades to "leave the
 * channel where it is" rather than blocking the rest of sync.
 */
async function moveChannelForArchiveState(
  channel: Awaited<ReturnType<Client["channels"]["fetch"]>>,
  env: BotEnv,
  item: ChannelWorkItem,
): Promise<void> {
  if (!channel || !("setParent" in channel) || !("parentId" in channel)) return;

  const desiredParentId = item.archived ? env.discordRunArchiveCategoryId : env.discordRunCategoryId;
  if (!desiredParentId) {
    if (item.archived) {
      console.warn(
        `[discord-bot] run ${item.runId} is archived but DISCORD_RUN_ARCHIVE_CATEGORY_ID is unset — leaving its channel where it is`,
      );
    }
    return;
  }
  if (channel.parentId === desiredParentId) return;

  // lockPermissions: false — a plain move, not a permission resync. Syncing
  // permissions from the destination category needs Manage Roles as well as
  // Manage Channels, and would silently overwrite this channel's own
  // overwrites; Archive/Restore only ever intends to relocate the channel.
  await (channel as { setParent: (id: string, options?: { lockPermissions?: boolean }) => Promise<unknown> })
    .setParent(desiredParentId, { lockPermissions: false })
    .catch((error: unknown) => {
      console.error(`[discord-bot] failed to move channel for run ${item.runId} to category ${desiredParentId}`, error);
    });
}

async function resolveRunChannel(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelWorkItem,
  legacyFallbackChannelId: string | null,
  allowCreate: boolean,
): Promise<string | null> {
  if (!env.discordRunCategoryId) {
    return legacyFallbackChannelId;
  }

  if (item.existingRunChannelId) {
    const existing = await client.channels.fetch(item.existingRunChannelId).catch(() => null);
    if (existing) {
      if ("setName" in existing && existing.name !== item.desiredChannelName) {
        await existing.setName(item.desiredChannelName).catch((error: unknown) => {
          console.error(`[discord-bot] failed to rename channel for run ${item.runId}`, error);
        });
      }
      await moveChannelForArchiveState(existing, env, item);
      return item.existingRunChannelId;
    }
    // Stored channel id no longer resolves (deleted in Discord) — fall through.
  }

  if (!allowCreate) {
    // Only the signup path may provision a Run's first channel (it alone is
    // gated by isSignupWindowOpen). A roster-only sync pass for a Run that
    // never went through a bot-observed signup phase — e.g. historical data
    // predating the bot, or the bot being offline through the entire signup
    // window — must not retroactively create Discord infrastructure for it.
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
  return created.id;
}

async function syncSignupPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelWorkItem & { existingMessageId: string | null },
  data: SignupEmbedData,
): Promise<void> {
  const channelId = await resolveRunChannel(client, env, api, item, env.discordSignupChannelId, true);
  if (!channelId) return;

  const embed = buildSignupEmbed(data);
  const row = buildSignupButtons(data);

  if (item.existingMessageId) {
    const edited = await tryEditMessage(client, channelId, item.existingMessageId, {
      embeds: [embed],
      components: [row],
    });
    if (edited) {
      await api.recordDiscordState(data.runId, { kind: "signup", channelId, messageId: item.existingMessageId });
      return;
    }
    // The stored message is gone (deleted in Discord) — fall through and repost.
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ embeds: [embed], components: [row] });
  await api.recordDiscordState(data.runId, { kind: "signup", channelId: message.channelId, messageId: message.id });
}

async function syncRosterPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: ChannelWorkItem & { existingMessageId: string | null },
  data: RosterEmbedData,
): Promise<void> {
  const channelId = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId, false);
  if (!channelId) return;

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
