import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Discord client routing — Quick Signup", () => {
  const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

  it("dispatches quick-signup buttons to handleQuickSignupButton", () => {
    expect(source).toContain('handleQuickSignupButton');
    expect(source).toMatch(/case\s+"quick-signup"\s*:[\s\S]*handleQuickSignupButton/);
  });
});
