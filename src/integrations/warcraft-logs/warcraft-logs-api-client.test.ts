import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWarcraftLogsClientTokenCacheForTests,
  warcraftLogsApiClient,
  warcraftLogsServerSlugFromRealm,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { toWarcraftLogsServerRegion } from "@/lib/warcraft-logs/config";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetWarcraftLogsClientTokenCacheForTests();
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetWarcraftLogsClientTokenCacheForTests();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("warcraftLogs region and slug mapping", () => {
  it("maps EU/US and rejects inventing other regions", () => {
    expect(toWarcraftLogsServerRegion("EU")).toBe("EU");
    expect(toWarcraftLogsServerRegion("US")).toBe("US");
  });

  it("reuses Blizzard-compatible realm slug rules", () => {
    expect(warcraftLogsServerSlugFromRealm("Twisting Nether")).toBe("twisting-nether");
    expect(warcraftLogsServerSlugFromRealm("Area 52")).toBe("area-52");
  });
});

describe("warcraftLogsApiClient", () => {
  it("returns NOT_CONFIGURED without credentials and never calls the network", async () => {
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "");
    const result = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Twisting Nether",
      region: "EU",
    });
    expect(result).toEqual({ status: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches the access token and refreshes near expiry", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            characterData: {
              character: { id: 11, canonicalID: 99, name: "Synlight", server: { slug: "twisting-nether" } },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            characterData: {
              character: { id: 11, canonicalID: 99, name: "Synlight", server: { slug: "twisting-nether" } },
            },
          },
        }),
      );

    const first = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Twisting Nether",
      region: "EU",
    });
    const second = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Twisting Nether",
      region: "EU",
    });

    expect(first.status).toBe("SUCCESS");
    expect(second.status).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(3); // token once + 2 graphql
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.warcraftlogs.com/oauth/token");

    // Force expiry refresh
    resetWarcraftLogsClientTokenCacheForTests();
    // Seed an expired cache via a short-lived token
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-short", expires_in: 1, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { characterData: { character: { id: 1, canonicalID: 1, name: "A" } } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-2", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { characterData: { character: { id: 1, canonicalID: 1, name: "A" } } },
        }),
      );

    await warcraftLogsApiClient.findCharacter({ name: "A", realm: "Kazzak", region: "EU" });
    // Advance past skew window for 1s token (skew is 60s, so 1s token is immediately stale)
    await warcraftLogsApiClient.findCharacter({ name: "A", realm: "Kazzak", region: "EU" });
    const tokenCalls = fetchMock.mock.calls.filter((call) => call[0] === "https://www.warcraftlogs.com/oauth/token");
    expect(tokenCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("prefers canonicalID for the persisted profile identity", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            characterData: {
              character: {
                id: 111,
                canonicalID: 999,
                name: "Synlight",
                server: { slug: "twisting-nether", region: { slug: "eu" } },
              },
            },
          },
        }),
      );

    const result = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Twisting Nether",
      region: "EU",
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      character: { warcraftLogsId: "999", id: "111", canonicalId: "999", name: "Synlight" },
    });
  });

  it("returns NOT_FOUND when character is null", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(jsonResponse({ data: { characterData: { character: null } } }));

    const result = await warcraftLogsApiClient.findCharacter({
      name: "Missing",
      realm: "Kazzak",
      region: "EU",
    });
    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("maps GraphQL errors and HTTP failures to TEMPORARY_FAILURE", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: "rate limited" }] }));

    const gql = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Kazzak",
      region: "EU",
    });
    expect(gql).toEqual({ status: "TEMPORARY_FAILURE", message: "rate limited" });

    resetWarcraftLogsClientTokenCacheForTests();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 500));
    const http = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Kazzak",
      region: "EU",
    });
    expect(http.status).toBe("TEMPORARY_FAILURE");
  });

  it("clears a poisoned token cache after token failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad" }, 401));
    const first = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Kazzak",
      region: "EU",
    });
    expect(first.status).toBe("TEMPORARY_FAILURE");

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "ok", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { characterData: { character: { id: 5, canonicalID: 5, name: "Synlight" } } },
        }),
      );
    const second = await warcraftLogsApiClient.findCharacter({
      name: "Synlight",
      realm: "Kazzak",
      region: "EU",
    });
    expect(second.status).toBe("SUCCESS");
  });

  it("returns TEMPORARY_FAILURE for malformed character payloads", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { characterData: { character: { name: "NoId" } } },
        }),
      );
    const result = await warcraftLogsApiClient.findCharacter({
      name: "NoId",
      realm: "Kazzak",
      region: "EU",
    });
    expect(result.status).toBe("TEMPORARY_FAILURE");
  });

  it("single-flights concurrent first token acquisitions", async () => {
    let resolveToken: ((value: Response) => void) | undefined;
    const tokenDeferred = new Promise<Response>((resolve) => {
      resolveToken = resolve;
    });

    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/oauth/token")) {
        return tokenDeferred;
      }
      return jsonResponse({
        data: {
          characterData: {
            character: {
              id: 11,
              canonicalID: 99,
              name: "Synlight",
              server: { slug: "twisting-nether", region: { slug: "EU" } },
            },
          },
        },
      });
    });

    const pending = Promise.all([
      warcraftLogsApiClient.findCharacter({
        name: "Alpha",
        realm: "Twisting Nether",
        region: "EU",
      }),
      warcraftLogsApiClient.findCharacter({
        name: "Beta",
        realm: "Twisting Nether",
        region: "EU",
      }),
      warcraftLogsApiClient.findCharacter({
        name: "Gamma",
        realm: "Twisting Nether",
        region: "EU",
      }),
    ]);

    await Promise.resolve();
    await Promise.resolve();

    const tokenCallsBeforeRelease = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/oauth/token"),
    );
    expect(tokenCallsBeforeRelease).toHaveLength(1);

    resolveToken!(jsonResponse({ access_token: "shared", expires_in: 3600, token_type: "Bearer" }));
    const results = await pending;
    expect(results.every((r) => r.status === "SUCCESS")).toBe(true);

    const tokenCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/oauth/token"));
    expect(tokenCalls).toHaveLength(1);
  });
});
