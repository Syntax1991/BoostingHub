import { afterEach, describe, expect, it, vi } from "vitest";
import type { RateLimitData } from "discord.js";
import { logRateLimit } from "@/discord-bot/client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRateLimit", () => {
  it("names the route and the wait, and nothing else from the event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimit({
      method: "GET",
      route: "/channels/:id/messages",
      scope: "user",
      global: false,
      limit: 1,
      retryAfter: 17_000,
      hash: "bucket-hash",
      url: "https://discord.com/api/v10/channels/1/messages",
      majorParameter: "1",
      sublimitTimeout: 0,
      timeToReset: 17_000,
    } as RateLimitData);

    expect(warn).toHaveBeenCalledWith("[discord-bot] rate limited", {
      method: "GET",
      route: "/channels/:id/messages",
      scope: "user",
      global: false,
      limit: 1,
      retryAfter: 17_000,
    });
  });
});
