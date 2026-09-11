import { describe, expect, it } from "vitest";
import { BotApiError } from "@/discord-bot/bot-api-client";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";

describe("describeBotApiError", () => {
  it("maps a known domain code to concise Discord copy", () => {
    expect(describeBotApiError(new BotApiError(400, "SIGNUP_CLOSED", "Signups are not open for this run."))).toBe(
      "Signups are closed for this run.",
    );
  });

  it("falls back to the server's own message for an unmapped code — never inventing a new rule", () => {
    const message = "You have no active signup on this run.";
    expect(describeBotApiError(new BotApiError(404, "NOT_FOUND", message))).toBe(message);
  });

  it("gives a generic message for a non-BotApiError failure", () => {
    expect(describeBotApiError(new Error("network blip"))).toMatch(/went wrong/i);
  });
});
