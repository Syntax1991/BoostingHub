import "dotenv/config";
import { createBotClient } from "@/discord-bot/client";
import { loadBotEnv } from "@/discord-bot/env";

const env = loadBotEnv();
const client = createBotClient(env);

process.on("SIGTERM", () => {
  console.log("[discord-bot] received SIGTERM, shutting down");
  client.destroy();
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[discord-bot] received SIGINT, shutting down");
  client.destroy();
  process.exit(0);
});

client.login(env.discordBotToken).catch((error) => {
  console.error("[discord-bot] failed to log in", error);
  process.exit(1);
});
