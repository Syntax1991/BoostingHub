import { readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, isProtectedPath, PROTECTED_PREFIXES, proxy } from "./proxy";

const ORIGIN = "https://phoenix-star.de";

function signedOutRequest(pathname: string) {
  return new NextRequest(new URL(pathname, ORIGIN));
}

function redirectLocation(pathname: string) {
  return proxy(signedOutRequest(pathname)).headers.get("location");
}

describe("proxy login return paths", () => {
  it.each([
    ["/settings", "/?next=%2Fsettings"],
    ["/notifications", "/?next=%2Fnotifications"],
    ["/profile", "/?next=%2Fprofile"],
    ["/dashboard", "/?next=%2Fdashboard"],
    ["/manage/runs", "/?next=%2Fmanage%2Fruns"],
  ])("redirects signed-out %s to %s", (pathname, expected) => {
    expect(redirectLocation(pathname)).toBe(`${ORIGIN}${expected}`);
  });

  it("does not intercept the public root", () => {
    expect(redirectLocation("/")).toBeNull();
  });

  it("lets requests with a session cookie through", () => {
    const request = signedOutRequest("/settings");
    request.cookies.set("better-auth.session_token", "token");
    expect(proxy(request).headers.get("location")).toBeNull();
  });

  it("does not treat lookalike or public paths as protected", () => {
    for (const pathname of ["/", "/api/auth/callback/discord", "/settingsx", "/dashboards"]) {
      expect(isProtectedPath(pathname)).toBe(false);
    }
  });
});

describe("proxy route coverage", () => {
  it("protects every top-level route in the (app) route group", () => {
    const appRoutes = readdirSync(path.join(__dirname, "app", "(app)"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("(") && !entry.name.startsWith("_"))
      .map((entry) => `/${entry.name}`)
      .sort();
    expect([...PROTECTED_PREFIXES].sort()).toEqual(appRoutes);
  });

  it("keeps config.matcher in sync with PROTECTED_PREFIXES", () => {
    expect([...config.matcher].sort()).toEqual(PROTECTED_PREFIXES.map((prefix) => `${prefix}/:path*`).sort());
  });
});
