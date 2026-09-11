import { Client, Events, GatewayIntentBits } from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { parseCustomId } from "@/discord-bot/custom-ids";
import type { BotEnv } from "@/discord-bot/env";
import { handleCancelButton } from "@/discord-bot/interactions/cancel-handler";
import {
  handleCharacterStepSelect,
  handleLootbuddySelect,
  handleRoleSelect,
  handleSignupButton,
  handleSignupConfirm,
} from "@/discord-bot/interactions/signup-flow";
import { handleMySignupsCommand } from "@/discord-bot/commands/mysignups";
import { startSyncLoop } from "@/discord-bot/sync-loop";

/**
 * Wires the gateway client to the pure embed/interaction modules. This file
 * is intentionally thin — every actual rule (eligibility, authorization,
 * offer reconciliation) lives behind the Bot API, never here.
 */
export function createBotClient(env: BotEnv): Client {
  const api = new BotApiClient(env);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[discord-bot] logged in as ${readyClient.user.tag}`);
    startSyncLoop(client, env, api);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.action === "cancel") {
          await handleCancelButton(interaction, api, parsed.runId);
        } else if (parsed.action === "signup-confirm") {
          await handleSignupConfirm(interaction, api, parsed.runId);
        } else if (parsed.action === "signup" || parsed.action === "lootbuddy") {
          await handleSignupButton(interaction, api, parsed.runId, parsed.action === "signup" ? "BOOSTER" : "LOOTBUDDY");
        }
        return;
      }

      if (interaction.isStringSelectMenu()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.action === "lootbuddy") {
          await handleLootbuddySelect(interaction, api, parsed.runId);
        } else if (parsed.action === "signup") {
          await handleCharacterStepSelect(interaction, api, parsed.runId);
        } else if (parsed.action === "signup-role" && parsed.characterId) {
          await handleRoleSelect(interaction, parsed.runId, parsed.characterId);
        }
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "mysignups") {
        await handleMySignupsCommand(interaction, api);
      }
    } catch (error) {
      console.error("[discord-bot] unhandled interaction error", error);
    }
  });

  return client;
}
