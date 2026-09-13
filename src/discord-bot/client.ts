import { Client, Events, GatewayIntentBits } from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { parseCharacterScopedCustomId, parseCustomId } from "@/discord-bot/custom-ids";
import type { BotEnv } from "@/discord-bot/env";
import { handleCancelButton } from "@/discord-bot/interactions/cancel-handler";
import {
  handleCharacterSelect,
  handleConfirmSignupButton,
  handleDiscardSignupButton,
  handleLootbuddyAddButton,
  handleLootbuddyButton,
  handleLootbuddyClassSelect,
  handleLootbuddyConfirmButton,
  handleLootbuddyDiscardButton,
  handleLootbuddyEditButton,
  handleLootbuddyEditPickSelect,
  handleLootbuddyModeSelect,
  handleLootbuddyRemoveButton,
  handleLootbuddyRemovePickSelect,
  handleRoleSelect,
  handleSignupButton,
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
        switch (parsed.action) {
          case "cancel":
            await handleCancelButton(interaction, api, parsed.runId);
            break;
          case "signup":
            await handleSignupButton(interaction, api, parsed.runId);
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
            await handleLootbuddyAddButton(interaction, parsed.runId);
            break;
          case "lootbuddy-edit":
            await handleLootbuddyEditButton(interaction, parsed.runId);
            break;
          case "lootbuddy-remove":
            await handleLootbuddyRemoveButton(interaction, parsed.runId);
            break;
          case "lootbuddy-confirm":
            await handleLootbuddyConfirmButton(interaction, api, parsed.runId);
            break;
          case "lootbuddy-discard":
            await handleLootbuddyDiscardButton(interaction, parsed.runId);
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
            case "lootbuddy-edit-pick":
              await handleLootbuddyEditPickSelect(interaction, parsed.runId);
              return;
            case "lootbuddy-remove-pick":
              await handleLootbuddyRemovePickSelect(interaction, api, parsed.runId);
              return;
            case "lootbuddy-class-select":
              await handleLootbuddyClassSelect(interaction, parsed.runId);
              return;
            case "lootbuddy-mode-select":
              await handleLootbuddyModeSelect(interaction, api, parsed.runId);
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
    } catch (error) {
      console.error("[discord-bot] unhandled interaction error", error);
    }
  });

  return client;
}
