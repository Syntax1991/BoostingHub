import type { Client, TextChannel } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import type { BotEnv } from "@/discord-bot/env";
import { BOOSTER_GUIDE_ANNOUNCEMENT_URL } from "@/discord-bot/guide-channels";

/** Stable idempotency key for the Quick Signup product announcement. */
export const QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY = "quick-signup-release-v1";

/** Safe allowed_mentions: never ping everyone/here/roles/users. */
export const GLOBAL_ANNOUNCEMENT_ALLOWED_MENTIONS = {
  parse: [] as string[],
  users: [] as string[],
  roles: [] as string[],
  repliedUser: false,
} as const;

export function buildQuickSignupReleaseAnnouncementContent(): string {
  return [
    "⚡ **New Feature — Quick Signup**",
    "",
    "We’ve added **Quick Signup** to the Manawyrm Hub Discord run channels.",
    "",
    "With one click, Quick Signup automatically offers **all of your currently eligible Booster characters** for the run using their specialization’s default role.",
    "",
    "**How it works:**",
    "• Existing signups stay unchanged",
    "• Unavailable or already reserved characters are skipped",
    "• Characters without a recognized default role are skipped",
    "• Quick Signup only creates your **Booster offers** — it does **not** automatically put you on the Roster",
    "• The Raid Lead still selects the final lineup",
    "",
    "If you want to choose specific characters or roles manually, use the normal **Signup** button as before.",
    "",
    "📘 Need more information? Check the **Booster Guide**:",
    BOOSTER_GUIDE_ANNOUNCEMENT_URL,
    "",
    "You can find **Quick Signup** directly underneath every active run’s Signups message. ⚡",
  ].join("\n");
}

/**
 * One-time product announcement lane — independent of Run / Schedule / Guide publishers.
 * Never throws into the caller: Discord send failures leave the row unrecorded for retry;
 * invalid channels are logged and skipped without crashing sync.
 */
export async function syncGlobalAnnouncements(
  client: Client,
  env: Pick<BotEnv, "discordAnnouncementChannelId">,
  api: Pick<BotApiClient, "getGlobalAnnouncement" | "recordGlobalAnnouncement">,
): Promise<void> {
  const channelId = env.discordAnnouncementChannelId;
  if (!channelId) return;

  try {
    await maybePostQuickSignupRelease(client, api, channelId);
  } catch (error) {
    console.error("[discord-bot] global announcement lane failed", error);
  }
}

async function maybePostQuickSignupRelease(
  client: Client,
  api: Pick<BotApiClient, "getGlobalAnnouncement" | "recordGlobalAnnouncement">,
  channelId: string,
): Promise<void> {
  const key = QUICK_SIGNUP_RELEASE_ANNOUNCEMENT_KEY;
  let existing: { recorded: boolean };
  try {
    existing = await api.getGlobalAnnouncement(key);
  } catch (error) {
    console.error(`[discord-bot] failed to check global announcement ${key}`, error);
    return;
  }
  if (existing.recorded) return;

  const content = buildQuickSignupReleaseAnnouncementContent();
  if (!content.includes("Quick Signup") || !content.includes(BOOSTER_GUIDE_ANNOUNCEMENT_URL)) {
    console.error(`[discord-bot] refusing to send malformed announcement ${key}`);
    return;
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    console.error(
      `[discord-bot] announcement channel ${channelId} inaccessible for ${key}`,
      error,
    );
    return;
  }

  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    console.error(
      `[discord-bot] announcement channel ${channelId} is missing or not text-based — skipping ${key}`,
    );
    return;
  }

  let messageId: string;
  try {
    const message = await (channel as TextChannel).send({
      content,
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });
    messageId = message.id;
  } catch (error) {
    console.error(`[discord-bot] failed to send global announcement ${key}`, error);
    return;
  }

  try {
    await api.recordGlobalAnnouncement({ key, channelId, messageId });
  } catch (error) {
    // Message already live; next poll will see the unique key race / existing row.
    console.error(`[discord-bot] sent ${key} but failed to persist delivery record`, error);
  }
}
