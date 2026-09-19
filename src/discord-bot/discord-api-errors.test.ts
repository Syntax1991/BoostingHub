import { describe, expect, it } from "vitest";
import {
  DISCORD_CANNOT_DM_CODE,
  DISCORD_UNKNOWN_CHANNEL_CODE,
  isDiscordCannotDmError,
  isDiscordUnknownChannelError,
} from "@/discord-bot/discord-api-errors";

describe("isDiscordUnknownChannelError", () => {
  it("accepts numeric and string 10003", () => {
    expect(isDiscordUnknownChannelError({ code: DISCORD_UNKNOWN_CHANNEL_CODE })).toBe(true);
    expect(isDiscordUnknownChannelError({ code: "10003" })).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isDiscordUnknownChannelError({ code: 50001 })).toBe(false);
    expect(isDiscordUnknownChannelError({ code: 50035 })).toBe(false);
    expect(isDiscordUnknownChannelError(new Error("network"))).toBe(false);
    expect(isDiscordUnknownChannelError(null)).toBe(false);
  });
});

describe("isDiscordCannotDmError", () => {
  it("accepts numeric and string 50007", () => {
    expect(isDiscordCannotDmError({ code: DISCORD_CANNOT_DM_CODE })).toBe(true);
    expect(isDiscordCannotDmError({ code: "50007" })).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isDiscordCannotDmError({ code: 10003 })).toBe(false);
    expect(isDiscordCannotDmError(null)).toBe(false);
  });
});
