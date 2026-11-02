import { describe, expect, it } from "vitest";
import { BotApiError } from "@/discord-bot/bot-api-client";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { notLinkedMessage } from "@/auth/bot-auth";
import { APP_BRAND_NAME } from "@/lib/branding";

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

  it("passes the server's 'not logged in yet' hint (with the dashboard link) through unchanged", () => {
    const message = notLinkedMessage({ BETTER_AUTH_URL: "https://hub.example.test/" } as unknown as NodeJS.ProcessEnv);
    expect(message).toBe(
      `You haven't logged in to ${APP_BRAND_NAME} yet. Please go to https://hub.example.test/dashboard and log in with Discord, then try again.`,
    );
    expect(describeBotApiError(new BotApiError(404, "DISCORD_ACCOUNT_NOT_LINKED", message))).toBe(message);
  });

  it("gives a generic message for a non-BotApiError failure", () => {
    expect(describeBotApiError(new Error("network blip"))).toMatch(/went wrong/i);
  });
});
