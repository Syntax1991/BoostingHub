import { describe, expect, it } from "vitest";
import {
  DISCORD_CANNOT_DM_CODE,
  DISCORD_NO_MUTUAL_GUILDS_CODE,
  DISCORD_UNKNOWN_CHANNEL_CODE,
  DISCORD_UNKNOWN_MESSAGE_CODE,
  isDiscordCannotDmError,
  isDiscordPermanentDmError,
  isDiscordUnknownChannelError,
  isDiscordUnknownMessageError,
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

describe("isDiscordUnknownMessageError", () => {
  it("accepts numeric and string 10008", () => {
    expect(isDiscordUnknownMessageError({ code: DISCORD_UNKNOWN_MESSAGE_CODE })).toBe(true);
    expect(isDiscordUnknownMessageError({ code: "10008" })).toBe(true);
  });

  it("rejects permission, network, and unknown-channel errors", () => {
    expect(isDiscordUnknownMessageError({ code: 10003 })).toBe(false);
    expect(isDiscordUnknownMessageError({ code: 50001 })).toBe(false);
    expect(isDiscordUnknownMessageError({ code: 50013 })).toBe(false);
    expect(isDiscordUnknownMessageError(new Error("ECONNRESET"))).toBe(false);
    expect(isDiscordUnknownMessageError(null)).toBe(false);
  });
});

describe("isDiscordCannotDmError", () => {
  it("accepts numeric and string 50007", () => {
    expect(isDiscordCannotDmError({ code: DISCORD_CANNOT_DM_CODE })).toBe(true);
    expect(isDiscordCannotDmError({ code: "50007" })).toBe(true);
  });

  it("accepts numeric and string 50278 (no mutual guilds)", () => {
    expect(isDiscordCannotDmError({ code: DISCORD_NO_MUTUAL_GUILDS_CODE })).toBe(true);
    expect(isDiscordCannotDmError({ code: "50278" })).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isDiscordCannotDmError({ code: 10003 })).toBe(false);
    expect(isDiscordCannotDmError(null)).toBe(false);
  });
});

describe("isDiscordPermanentDmError", () => {
  it("is permanent for closed DMs, no mutual guilds and missing access/permissions", () => {
    for (const code of [50007, 50278, 50001, 50013, "50278"]) {
      expect(isDiscordPermanentDmError({ code })).toBe(true);
    }
  });

  it("stays retryable for rate limits, 5xx, network and unknown codes", () => {
    expect(isDiscordPermanentDmError({ name: "RateLimitError", status: 429 })).toBe(false);
    expect(isDiscordPermanentDmError({ status: 500, message: "Internal Server Error" })).toBe(false);
    expect(isDiscordPermanentDmError({ status: 503 })).toBe(false);
    expect(isDiscordPermanentDmError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(isDiscordPermanentDmError({ code: 50035 })).toBe(false);
    expect(isDiscordPermanentDmError({ code: 10003 })).toBe(false);
    expect(isDiscordPermanentDmError(null)).toBe(false);
  });
});
