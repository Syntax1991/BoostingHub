import { GatewayIntentBits } from "discord.js";

/**
 * Gateway intents for the bot. GuildVoiceStates keeps the voice-state cache
 * current so temporary Run voice channels know who is still connected
 * (`channel.members`) before cleanup. Add nothing else without a reason.
 *
 * No MessageContent intent: nothing reads messages over the gateway —
 * transcripts and the Warcraft Logs link scan use REST history, which follows
 * the application's Message Content access (Developer Portal toggle) instead.
 * Requesting the intent without that toggle would make Discord reject the login.
 * See src/discord-bot/message-content.ts.
 */
export const BOT_GATEWAY_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] as const;
