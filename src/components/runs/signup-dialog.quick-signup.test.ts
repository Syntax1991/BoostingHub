import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Web Signup dialog — Quick Signup placement", () => {
  const source = readFileSync(new URL("./signup-dialog.tsx", import.meta.url), "utf8");

  it("no longer exposes Quick Signup in the Web dialog", () => {
    expect(source).not.toContain("Quick Signup");
    expect(source).not.toContain("quickSignupBoostersAction");
    expect(source).not.toContain("submitQuickSignup");
  });

  it("keeps manual Booster offer management", () => {
    expect(source).toContain("Save Booster Offers");
    expect(source).toContain("setCharacterOffersAction");
    expect(source).toContain("selectAllEligibleBooster");
  });
});
