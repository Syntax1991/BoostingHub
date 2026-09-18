import { describe, expect, it } from "vitest";
import {
  DISCORD_UNKNOWN_CHANNEL_CODE,
  isDiscordUnknownChannelError,
} from "@/discord-bot/discord-api-errors";

describe("isDiscordUnknownChannelError", () => {
  it("recognizes Discord Unknown Channel (10003)", () => {
    expect(isDiscordUnknownChannelError({ code: DISCORD_UNKNOWN_CHANNEL_CODE })).toBe(true);
    expect(isDiscordUnknownChannelError({ code: "10003" })).toBe(true);
  });

  it("does not treat Missing Access or other failures as deletion", () => {
    expect(isDiscordUnknownChannelError({ code: 50001 })).toBe(false);
    expect(isDiscordUnknownChannelError({ code: 50035 })).toBe(false);
    expect(isDiscordUnknownChannelError(new Error("network"))).toBe(false);
    expect(isDiscordUnknownChannelError(null)).toBe(false);
  });
});
