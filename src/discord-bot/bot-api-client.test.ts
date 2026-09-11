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

  it("logs (without leaking the token) and rethrows a transport-level failure (e.g. the API base URL unreachable)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const transportError = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(transportError);
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await expect(client.listSyncWork()).rejects.toBe(transportError);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET https://api.test/api/bot/discord/sync"),
      transportError,
    );
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(loggedText).not.toContain("secret-token");
  });

  it("logs the status/body and throws a clear error when the response is not JSON (e.g. a framework error page)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>Internal Server Error</html>", { status: 500, headers: { "content-type": "text/html" } }),
    );
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await expect(client.listSyncWork()).rejects.toThrow(/non-JSON response/);
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(loggedText).toContain("status=500");
    expect(loggedText).toContain("Internal Server Error");
    expect(loggedText).not.toContain("secret-token");
  });

  it("logs and rethrows when the body claims to be JSON but fails to parse", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{not valid json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new BotApiClient({ apiBaseUrl: "https://api.test", botApiToken: "secret-token" });

    await expect(client.listSyncWork()).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(loggedText).not.toContain("secret-token");
  });
});
