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

  it("summarizes missing and long user agents", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
    expect(summarizeUserAgent("a".repeat(130)).endsWith("…")).toBe(true);
  });
});
