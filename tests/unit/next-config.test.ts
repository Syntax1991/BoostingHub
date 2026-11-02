import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("HTTP security headers", () => {
  it("applies the security headers to every path and hides the framework header", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
    const headers = Object.fromEntries(rules[0]!.headers.map((header) => [header.key, header.value]));
    expect(headers).toMatchObject({
      "Strict-Transport-Security": "max-age=15552000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    // Report-Only until owner approves enforce (docs/audit/CSP-PREPARATION.md).
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("cdn.discordapp.com");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
