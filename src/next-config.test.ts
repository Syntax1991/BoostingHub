import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("HTTP security headers", () => {
  it("applies the security headers to every path and hides the framework header", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
    expect(Object.fromEntries(rules[0]!.headers.map((header) => [header.key, header.value]))).toEqual({
      "Strict-Transport-Security": "max-age=15552000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
