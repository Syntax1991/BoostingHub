import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { loadBotEnv } from "@/discord-bot/env";

/**
 * One-off registration script for the guild slash command set. Run manually
 * after deploying (`npm run bot:register-commands`) or whenever the command
 * list changes — the gateway process does not re-register commands itself.
 */
async function main() {
  const env = loadBotEnv();
  const commands = [new SlashCommandBuilder().setName("mysignups").setDescription("Show your current signups, grouped by Run.")];

  const rest = new REST().setToken(env.discordBotToken);
  await rest.put(Routes.applicationGuildCommands(env.discordApplicationId, env.discordGuildId), {
    body: commands.map((command) => command.toJSON()),
  });
  console.log("[discord-bot] registered guild slash commands: /mysignups");
}

main().catch((error) => {
  console.error("[discord-bot] failed to register slash commands", error);
  process.exitCode = 1;
});
