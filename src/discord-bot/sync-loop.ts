import type { Client, MessageEditOptions } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import type { RosterEmbedData, SignupEmbedData } from "@/services/discord-sync.service";

type SyncWork = Awaited<ReturnType<BotApiClient["listSyncWork"]>>;

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
    await syncSignupPost(client, env, api, item as { runId: string; existingChannelId: string | null; existingMessageId: string | null }, item.embed as SignupEmbedData);
  }

  for (const item of work.roster) {
    const data = (await api.getRosterEmbedData(item.runId).catch(() => null)) as RosterEmbedData | null;
    if (!data) continue;
    await syncRosterPost(client, env, api, item, data);
  }
}

async function syncSignupPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: { existingChannelId: string | null; existingMessageId: string | null },
  data: SignupEmbedData,
): Promise<void> {
  const embed = buildSignupEmbed(data);
  const row = buildSignupButtons(data);

  if (item.existingChannelId && item.existingMessageId) {
    const edited = await tryEditMessage(client, item.existingChannelId, item.existingMessageId, {
      embeds: [embed],
      components: [row],
    });
    if (edited) {
      await api.recordDiscordState(data.runId, {
        kind: "signup",
        channelId: item.existingChannelId,
        messageId: item.existingMessageId,
      });
      return;
    }
    // The stored message is gone (deleted in Discord) — fall through and repost.
  }

  const channel = await client.channels.fetch(env.discordSignupChannelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ embeds: [embed], components: [row] });
  await api.recordDiscordState(data.runId, {
    kind: "signup",
    channelId: message.channelId,
    messageId: message.id,
  });
}

async function syncRosterPost(
  client: Client,
  env: BotEnv,
  api: BotApiClient,
  item: { runId: string; existingChannelId: string | null; existingMessageId: string | null },
  data: RosterEmbedData,
): Promise<void> {
  const embed = buildRosterEmbed(data);

  if (item.existingChannelId && item.existingMessageId) {
    const edited = await tryEditMessage(client, item.existingChannelId, item.existingMessageId, { embeds: [embed] });
    if (edited) {
      await api.recordDiscordState(item.runId, {
        kind: "roster",
        channelId: item.existingChannelId,
        messageId: item.existingMessageId,
      });
      return;
    }
  }

  const channel = await client.channels.fetch(env.discordRosterChannelId);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.send({ embeds: [embed] });
  await api.recordDiscordState(item.runId, {
    kind: "roster",
    channelId: message.channelId,
    messageId: message.id,
  });
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
