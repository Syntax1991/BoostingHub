import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDomainError } from "@/lib/errors";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";

/**
 * HTTP → DomainError classification at the public client boundary (fetch mocked).
 * Only an account-profile 403 is BATTLENET_ACCOUNT_PROFILE_FORBIDDEN; every other
 * 401/403 keeps BATTLENET_AUTH_FAILED.
 */

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return isDomainError(error) ? { code: error.code, message: error.message } : { code: "NOT_A_DOMAIN_ERROR", message: "" };
  }
  throw new Error("Expected the call to fail");
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "https://hub.test/api/integrations/battlenet/callback");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("blizzardApiClient — 401/403 classification", () => {
  it("account-profile HTTP 403 → BATTLENET_ACCOUNT_PROFILE_FORBIDDEN (sign-in itself succeeded)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403));
    const result = await codeOf(blizzardApiClient.getAccountProfile("user-token", "EU"));
    expect(result.code).toBe("BATTLENET_ACCOUNT_PROFILE_FORBIDDEN");
    expect(result.message).toBe("Battle.net sign-in succeeded, but Blizzard denied access to the WoW account profile.");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/profile/user/wow");
  });

  it("account-profile HTTP 401 → BATTLENET_AUTH_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    expect((await codeOf(blizzardApiClient.getAccountProfile("user-token", "EU"))).code).toBe("BATTLENET_AUTH_FAILED");
  });

  it("userinfo HTTP 403 → BATTLENET_AUTH_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403));
    expect((await codeOf(blizzardApiClient.getUserInfo("user-token"))).code).toBe("BATTLENET_AUTH_FAILED");
  });

  it("token-exchange HTTP 403 → BATTLENET_AUTH_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403));
    expect((await codeOf(blizzardApiClient.exchangeAuthorizationCode("auth-code"))).code).toBe("BATTLENET_AUTH_FAILED");
  });

  it("an unrelated Blizzard API 403 (public character profile) keeps BATTLENET_AUTH_FAILED", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "client-token", token_type: "bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(403));
    const result = await codeOf(blizzardApiClient.getCharacterProfileSummary("EU", "draenor", "Somename"));
    expect(result.code).toBe("BATTLENET_AUTH_FAILED");
    expect(result.message).toContain("character-summary, HTTP 403");
  });

  it("account-profile 200 still returns the owned characters list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { wow_accounts: [] }));
    await expect(blizzardApiClient.getAccountProfile("user-token", "EU")).resolves.toEqual([]);
  });
});
