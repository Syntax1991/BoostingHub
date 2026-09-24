import { GatewayIntentBits } from "discord.js";

/**
 * Gateway intents for the bot. GuildVoiceStates keeps the voice-state cache
 * current so temporary Run voice channels know who is still connected
 * (`channel.members`) before cleanup. Add nothing else without a reason.
 */
export const BOT_GATEWAY_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] as const;
