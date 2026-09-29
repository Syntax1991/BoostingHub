import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The real Better Auth Discord sign-in route (auth.api.signInSocial) must produce an
 * authorize URL with prompt=consent, so Discord always shows which account is used.
 * Only non-secret URL parts are asserted; state / PKCE values are never printed.
 */

const TEST_CLIENT_ID = "discord-test-client-id";
let auth: typeof import("@/auth/auth").auth;

beforeAll(async () => {
  vi.stubEnv("DISCORD_CLIENT_ID", TEST_CLIENT_ID);
  vi.stubEnv("DISCORD_CLIENT_SECRET", "discord-test-client-secret");
  vi.stubEnv("BETTER_AUTH_URL", "https://hub.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-oauth-url-test-only-0123456789");
  vi.resetModules();
  ({ auth } = await import("@/auth/auth"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("Discord OAuth authorize URL (real sign-in route)", () => {
  it("points at Discord's authorize endpoint with prompt=consent", async () => {
    const result = await auth.api.signInSocial({
      body: { provider: "discord", callbackURL: "/dashboard", disableRedirect: true },
    });
    const url = new URL(String(result.url));

    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("discord.com");
    expect(url.pathname).toBe("/api/oauth2/authorize");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.test/api/auth/callback/discord");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["identify", "email"]));
    // Present, but never logged or snapshotted.
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("keeps the Discord profile mapping: snowflake is the identity, names are descriptive", () => {
    const discord = (auth.options.socialProviders as { discord?: { prompt?: string; mapProfileToUser?: (p: unknown) => unknown } })
      .discord;
    expect(discord?.prompt).toBe("consent");
    expect(
      discord?.mapProfileToUser?.({
        id: "123456789012345678",
        username: "someone",
        global_name: "Some One",
        image_url: "https://cdn.discordapp.com/avatars/x.png",
      }),
    ).toEqual({
      name: "Some One",
      image: "https://cdn.discordapp.com/avatars/x.png",
      discordUserId: "123456789012345678",
      discordUsername: "someone",
    });
    expect(
      discord?.mapProfileToUser?.({ id: "1", username: "fallback", global_name: null, image_url: null }),
    ).toEqual({ name: "fallback", image: undefined, discordUserId: "1", discordUsername: "fallback" });
  });

  it("session policy and token encryption are unchanged", () => {
    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 30);
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24);
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
});
