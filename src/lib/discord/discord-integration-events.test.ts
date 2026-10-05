import { describe, expect, it } from "vitest";
import {
  classifyDiscordTelemetryError,
  discordSyncPassStatus,
  extractDiscordApiCode,
} from "@/lib/discord/discord-integration-events";

describe("discord integration event helpers", () => {
  it("classifies 10008 as WARNING Unknown Message", () => {
    expect(classifyDiscordTelemetryError({ code: 10008 })).toEqual({
      errorCode: "DISCORD_UNKNOWN_MESSAGE",
      status: "WARNING",
      discordCode: 10008,
      httpStatus: 404,
    });
  });

  it("classifies 50013 as ERROR Missing Permissions", () => {
    expect(classifyDiscordTelemetryError({ code: 50013 })).toEqual({
      errorCode: "DISCORD_MISSING_PERMISSIONS",
      status: "ERROR",
      discordCode: 50013,
      httpStatus: 403,
    });
  });

  it("classifies rate limits as WARNING", () => {
    expect(classifyDiscordTelemetryError({ name: "RateLimitError", status: 429 }).errorCode).toBe(
      "DISCORD_RATE_LIMITED",
    );
  });

  it("rolls SYNC_ONCE status from lane counters", () => {
    expect(discordSyncPassStatus({ warningCount: 0, errorCount: 0 })).toBe("SUCCESS");
    expect(discordSyncPassStatus({ warningCount: 2, errorCount: 0 })).toBe("WARNING");
    expect(discordSyncPassStatus({ warningCount: 1, errorCount: 1 })).toBe("ERROR");
  });

  it("extracts numeric discord codes from string codes", () => {
    expect(extractDiscordApiCode({ code: "10008" })).toBe(10008);
  });
});
