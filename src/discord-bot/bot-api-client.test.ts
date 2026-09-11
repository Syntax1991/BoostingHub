import { afterEach, describe, expect, it, vi } from "vitest";
import { BotApiClient, BotApiError } from "@/discord-bot/bot-api-client";

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BotApiClient", () => {
  it("attaches the bot token and base URL on every request", async () => {
    const spy = mockFetchOnce(200, { ok: true, data: { signups: [], roster: [] } });
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await client.listSyncWork();

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.test/api/bot/discord/sync");
    expect((init?.headers as Headers).get("authorization")).toBe("Bearer secret-token");
  });

  it("attaches the acting Discord user header for per-User calls", async () => {
    const spy = mockFetchOnce(200, { ok: true, data: {} });
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await client.getSignupOptions("run-1", "discord-123");

    const [, init] = spy.mock.calls[0];
    expect((init?.headers as Headers).get("x-discord-user-id")).toBe("discord-123");
  });

  it("throws BotApiError with the server's code, message, and HTTP status on failure", async () => {
    mockFetchOnce(404, { ok: false, code: "NOT_FOUND", message: "No BoostingHub account is linked to this Discord user." });
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await expect(client.getSignupOptions("run-1", "unknown")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("is an instance of BotApiError specifically", async () => {
    mockFetchOnce(401, { ok: false, code: "NOT_AUTHORIZED", message: "Invalid bot credential." });
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "wrong" });

    try {
      await client.listSyncWork();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BotApiError);
    }
  });
});
