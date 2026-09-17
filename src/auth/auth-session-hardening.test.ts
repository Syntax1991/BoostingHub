import { describe, expect, it } from "vitest";
import { resolveBetterAuthBaseURL } from "@/auth/better-auth-base-url";
import { resolveSafeCallbackPath, isSafeInternalPath } from "@/auth/safe-callback-path";
import { summarizeUserAgent, toPublicSessionView } from "@/auth/session-view";
import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/auth/session-policy";

describe("Better Auth session policy constants", () => {
  it("uses a 30-day expiresIn and 1-day updateAge", () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(60 * 60 * 24);
  });
});

describe("resolveBetterAuthBaseURL", () => {
  it("returns the configured URL when set", () => {
    expect(
      resolveBetterAuthBaseURL({
        BETTER_AUTH_URL: "https://boostinghub.example",
        NODE_ENV: "production",
      }),
    ).toBe("https://boostinghub.example");
  });

  it("falls back to localhost outside production", () => {
    expect(resolveBetterAuthBaseURL({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("rejects missing URL in production instead of localhost fallback", () => {
    expect(() => resolveBetterAuthBaseURL({ NODE_ENV: "production" })).toThrow(
      /BETTER_AUTH_URL must be set/,
    );
  });
});

describe("resolveSafeCallbackPath", () => {
  it("accepts safe internal paths", () => {
    expect(resolveSafeCallbackPath("/characters")).toBe("/characters");
    expect(resolveSafeCallbackPath("/runs?difficulty=HEROIC")).toBe("/runs?difficulty=HEROIC");
  });

  it("rejects absolute, protocol-relative, and external callbacks", () => {
    expect(resolveSafeCallbackPath("https://evil.example/phish")).toBe("/dashboard");
    expect(resolveSafeCallbackPath("//evil.example/phish")).toBe("/dashboard");
    expect(resolveSafeCallbackPath("/\\evil.example")).toBe("/dashboard");
    expect(resolveSafeCallbackPath("javascript:alert(1)")).toBe("/dashboard");
    expect(resolveSafeCallbackPath("http://localhost:3000/dashboard")).toBe("/dashboard");
  });

  it("rejects credential-bearing and control-character paths", () => {
    expect(isSafeInternalPath("/@attacker")).toBe(false);
    expect(resolveSafeCallbackPath("/ok\n/evil")).toBe("/dashboard");
  });

  it("falls back when candidate is empty", () => {
    expect(resolveSafeCallbackPath(null)).toBe("/dashboard");
    expect(resolveSafeCallbackPath("   ")).toBe("/dashboard");
  });
});

describe("session view sanitization", () => {
  it("never includes the raw session token", () => {
    const view = toPublicSessionView(
      {
        id: "sess-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        expiresAt: new Date("2026-01-31T00:00:00.000Z"),
        token: "raw-session-token-secret",
        ipAddress: "203.0.113.10",
        userAgent: "Mozilla/5.0 TestBrowser",
        userId: "user-1",
      },
      "sess-1",
    );

    expect(view).toEqual({
      id: "sess-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      expiresAt: new Date("2026-01-31T00:00:00.000Z"),
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 TestBrowser",
      isCurrent: true,
    });
    expect(JSON.stringify(view)).not.toContain("raw-session-token-secret");
    expect(view).not.toHaveProperty("token");
  });

  it("formats human-readable browser/platform labels without raw UA", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
      ),
    ).toBe("Edge on Windows");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
      ),
    ).toBe("Firefox on Windows");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPad");

    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");

    // Chrome on iOS must not be reported as Safari.
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Chrome on iPhone");

    expect(summarizeUserAgent(null)).toBe("Unknown device");
    expect(summarizeUserAgent("")).toBe("Unknown device");
    expect(summarizeUserAgent("   ")).toBe("Unknown device");
    expect(summarizeUserAgent("curl/8.0")).toBe("Unknown device");
  });
});
