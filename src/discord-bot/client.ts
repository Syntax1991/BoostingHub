import { Client, Events } from "discord.js";
import { BOT_GATEWAY_INTENTS } from "@/discord-bot/intents";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { parseCharacterScopedCustomId, parseCustomId } from "@/discord-bot/custom-ids";
import type { BotEnv } from "@/discord-bot/env";
import { handleCancelButton } from "@/discord-bot/interactions/cancel-handler";
import {
  handleCharacterSelect,
  handleConfirmSignupButton,
  handleDiscardSignupButton,
  handleLootbuddyButton,
  handleLootbuddyClassSelect,
  handleRoleSelect,
  handleSignupButton,
  handleSignupNextButton,
  handleStaleLootbuddyWizardButton,
  handleStaleLootbuddyWizardSelect,
} from "@/discord-bot/interactions/signup-flow";
import { handleGuideCommand } from "@/discord-bot/commands/guide";
import { handleMySignupsCommand } from "@/discord-bot/commands/mysignups";
import { startSyncLoop } from "@/discord-bot/sync-loop";

/**
 * Wires the gateway client to the pure embed/interaction modules. This file
 * is intentionally thin — every actual rule (eligibility, authorization,
 * offer reconciliation) lives behind the Bot API, never here.
 */
export function createBotClient(env: BotEnv): Client {
  const api = new BotApiClient(env);
  const client = new Client({ intents: [...BOT_GATEWAY_INTENTS] });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[discord-bot] logged in as ${readyClient.user.tag}`);
    startSyncLoop(client, env, api);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        switch (parsed.action) {
          case "cancel":
            await handleCancelButton(interaction, api, parsed.runId);
            break;
          case "signup":
            await handleSignupButton(interaction, api, parsed.runId);
            break;
          case "signup-next":
            await handleSignupNextButton(interaction, api, parsed.runId);
            break;
          case "signup-confirm":
            await handleConfirmSignupButton(interaction, api, parsed.runId);
            break;
          case "signup-discard":
            await handleDiscardSignupButton(interaction, parsed.runId);
            break;
          case "lootbuddy":
            await handleLootbuddyButton(interaction, api, parsed.runId);
            break;
          case "lootbuddy-add":
          case "lootbuddy-edit":
          case "lootbuddy-remove":
          case "lootbuddy-confirm":
          case "lootbuddy-discard":
            await handleStaleLootbuddyWizardButton(interaction);
            break;
          default:
            break;
        }
        return;
      }

      if (interaction.isStringSelectMenu()) {
        const parsed = parseCustomId(interaction.customId);
        if (parsed) {
          switch (parsed.action) {
            case "signup":
              await handleCharacterSelect(interaction, api, parsed.runId);
              return;
            case "lootbuddy-class-select":
              await handleLootbuddyClassSelect(interaction, api, parsed.runId);
              return;
            case "lootbuddy-edit-pick":
            case "lootbuddy-remove-pick":
            case "lootbuddy-mode-select":
              await handleStaleLootbuddyWizardSelect(interaction);
              return;
            default:
              break;
          }
        }
        const scoped = parseCharacterScopedCustomId(interaction.customId);
        if (scoped) {
          await handleRoleSelect(interaction, api, scoped.runId, scoped.characterId);
        }
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "mysignups") {
        await handleMySignupsCommand(interaction, api);
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "guide") {
        await handleGuideCommand(interaction, env.discordGuildId);
      }
    } catch (error) {
      console.error("[discord-bot] unhandled interaction error", error);
    }
  });

  return client;
}
