import { describe, expect, it } from "vitest";
import { absoluteAppUrl, absoluteRunUrl } from "@/lib/app-url";
import { runDetailPath } from "@/lib/run-routes";

describe("run detail path", () => {
  it("uses the canonical /runs/[runId] path", () => {
    expect(runDetailPath("abc-123")).toBe("/runs/abc-123");
  });
});

describe("absoluteRunUrl", () => {
  it("joins the configured origin and the canonical run path", () => {
    expect(absoluteRunUrl("run-123", undefined, { BETTER_AUTH_URL: "https://example.test", NODE_ENV: "test" })).toBe(
      "https://example.test/runs/run-123",
    );
  });

  it("strips a trailing slash so the path is not doubled", () => {
    expect(absoluteRunUrl("run-123", undefined, { BETTER_AUTH_URL: "https://example.test/", NODE_ENV: "test" })).toBe(
      "https://example.test/runs/run-123",
    );
  });

  it("returns null when production has no base URL", () => {
    expect(absoluteRunUrl("run-123", undefined, { NODE_ENV: "production" })).toBeNull();
    expect(absoluteAppUrl("/runs/run-123", { NODE_ENV: "production" })).toBeNull();
  });

  it("returns null for a blank run id or a non-http origin", () => {
    expect(absoluteRunUrl("  ", undefined, { BETTER_AUTH_URL: "https://example.test", NODE_ENV: "test" })).toBeNull();
    expect(absoluteRunUrl("run-123", undefined, { BETTER_AUTH_URL: "ftp://example.test", NODE_ENV: "test" })).toBeNull();
  });
});
