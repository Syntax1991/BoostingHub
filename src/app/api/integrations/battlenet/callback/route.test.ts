import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";

/**
 * GET /api/integrations/battlenet/callback — an account-profile 403 must reach the
 * user as its own code and write nothing. Real battleNetService + DB; the Blizzard
 * client, the session and the OAuth state check are mocked.
 */

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-bncb00000001";

const user: AuthenticatedUser = {
  id: USER_ID,
  name: "Callback Owner",
  email: `${USER_ID}@bncbtest.boostting.local`,
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "USER",
  accountStatus: "ACTIVE",
};

const apiMocks = vi.hoisted(() => ({
  buildAuthorizationUrl: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  getUserInfo: vi.fn(),
  getAccountProfile: vi.fn(),
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
}));

vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({ blizzardApiClient: apiMocks }));
vi.mock("@/auth/session", () => ({ requireUser: vi.fn(async () => user) }));
vi.mock("@/lib/blizzard/oauth-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blizzard/oauth-state")>()),
  consumeBattleNetOAuthState: vi.fn(() => ({ region: "EU" })),
}));

import { GET } from "@/app/api/integrations/battlenet/callback/route";

function callbackRequest() {
  // Placeholder query values only — the route never logs or echoes them.
  return new NextRequest("https://hub.test/api/integrations/battlenet/callback?code=placeholder&state=placeholder");
}

async function persistedCounts() {
  const connections = await orm.BattleNetConnection.where({ userId: USER_ID }).select("id").all();
  const sessions = await orm.BattleNetImportSession.where({ userId: USER_ID }).select("id").all();
  return { connections: connections.length, sessions: sessions.length };
}

async function deleteUser() {
  try {
    await orm.User.where({ id: USER_ID }).delete();
  } catch {
    // Already gone.
  }
}

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "https://hub.test/api/integrations/battlenet/callback");
  await deleteUser();
  await orm.User.create({
    id: USER_ID,
    name: user.name,
    email: user.email,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  await deleteUser();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.exchangeAuthorizationCode.mockResolvedValue({ accessToken: "ephemeral", scope: "wow.profile openid" });
  apiMocks.getUserInfo.mockResolvedValue({ sub: "bn-callback", battletag: "Owner#1234" });
});

describe("battlenet callback — account profile denied", () => {
  it("redirects to /characters with BATTLENET_ACCOUNT_PROFILE_FORBIDDEN and persists no connection or import session", async () => {
    apiMocks.getAccountProfile.mockRejectedValue(
      new DomainError(
        "BATTLENET_ACCOUNT_PROFILE_FORBIDDEN",
        "Battle.net sign-in succeeded, but Blizzard denied access to the WoW account profile.",
        403,
      ),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(callbackRequest());

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/characters");
    expect(location.searchParams.get("battlenet")).toBe("error");
    expect(location.searchParams.get("code")).toBe("BATTLENET_ACCOUNT_PROFILE_FORBIDDEN");
    expect(location.searchParams.has("importSession")).toBe(false);
    expect(await persistedCounts()).toEqual({ connections: 0, sessions: 0 });

    // The safe server log carries the specific code, never the OAuth query values.
    const line = logged.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(line).toContain("(BATTLENET_ACCOUNT_PROFILE_FORBIDDEN)");
    expect(line).not.toContain("placeholder");
    expect(line).not.toContain("ephemeral");
    logged.mockRestore();
  });

  it("a genuine auth failure still redirects with BATTLENET_AUTH_FAILED", async () => {
    apiMocks.getUserInfo.mockRejectedValue(
      new DomainError("BATTLENET_AUTH_FAILED", "Battle.net authorization failed (userinfo, HTTP 401).", 401),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(callbackRequest());
    logged.mockRestore();

    expect(new URL(response.headers.get("location") ?? "").searchParams.get("code")).toBe("BATTLENET_AUTH_FAILED");
    expect(apiMocks.getAccountProfile).not.toHaveBeenCalled();
    expect(await persistedCounts()).toEqual({ connections: 0, sessions: 0 });
  });

  it("account profile 200 still connects and opens an import session (regression)", async () => {
    apiMocks.getAccountProfile.mockResolvedValue([]);
    const response = await GET(callbackRequest());

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("battlenet")).toBe("connected");
    expect(location.searchParams.get("region")).toBe("EU");
    expect(location.searchParams.get("importSession")).toBeTruthy();
    expect(await persistedCounts()).toEqual({ connections: 1, sessions: 1 });
  });
});
