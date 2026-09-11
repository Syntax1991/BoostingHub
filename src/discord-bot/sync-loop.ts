import { ChannelType, type CategoryChannel, type Client, type MessageEditOptions } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import type { RosterEmbedData, SignupEmbedData } from "@/services/discord-sync.service";

type SyncWork = Awaited<ReturnType<BotApiClient["listSyncWork"]>>;
type ChannelWorkItem = { runId: string; existingRunChannelId: string | null; desiredChannelName: string };

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
 * one is created — this is self-healing, not the bot deleting anything.
 *
 * A Run needing both a signup update AND a fresh roster post in the same
 * pass only happens after its channel already exists (roster requires
 * PUBLISHED, which is only reachable after the Run was signup-postable,
 * which is what creates the channel) — so this is never called twice with
 * `existingRunChannelId: null` for the same Run in one pass.
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
      return item.existingRunChannelId;
    }
    // Stored channel id no longer resolves (deleted in Discord) — fall through and recreate.
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
  const channelId = await resolveRunChannel(client, env, api, item, env.discordSignupChannelId);
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
  const channelId = await resolveRunChannel(client, env, api, item, env.discordRosterChannelId);
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
