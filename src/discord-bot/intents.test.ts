import { readFileSync } from "node:fs";
import path from "node:path";
import { GatewayIntentBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { BOT_GATEWAY_INTENTS } from "@/discord-bot/intents";

describe("BOT_GATEWAY_INTENTS", () => {
  it("is exactly Guilds + GuildVoiceStates (voice occupancy for temporary Run voice channels)", () => {
    expect([...BOT_GATEWAY_INTENTS]).toEqual([GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]);
  });

  it("is what the bot client is constructed with (no separate intent list)", () => {
    const source = readFileSync(path.join(__dirname, "client.ts"), "utf8");
    expect(source).toContain("new Client({ intents: [...BOT_GATEWAY_INTENTS] })");
    expect(source).not.toContain("GatewayIntentBits.");
  });
});
