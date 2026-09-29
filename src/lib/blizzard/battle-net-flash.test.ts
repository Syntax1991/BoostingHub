import { describe, expect, it } from "vitest";
import { battleNetErrorFlashCleanUrl, battleNetFlashMessage } from "@/lib/blizzard/battle-net-flash";

const error = (code: string | null) => ({ status: "error", region: null, code, linked: 0 });

describe("battleNetFlashMessage", () => {
  it("renders an account-profile denial as a titled callout without internals", () => {
    const message = battleNetFlashMessage(error("BATTLENET_ACCOUNT_PROFILE_FORBIDDEN"));
    expect(message?.tone).toBe("danger");
    expect(message?.callout).toEqual({
      kind: "account-profile-forbidden",
      title: "Battle.net character list unavailable",
      paragraphs: [
        "Your Battle.net sign-in was successful, but Blizzard did not allow Manawyrm Hub to access your WoW character list. " +
          "This is a restriction returned by Blizzard, not a failed login.",
        "You can still add your characters manually. They will continue to update through Blizzard's public character profile.",
      ],
    });
    // No code, HTTP status, "connection failed" or retry advice anywhere in the prose.
    expect(message?.text).not.toMatch(/BATTLENET_|HTTP|403|connection failed|try again|reconnect/i);
  });

  it("keeps the generic fallback for BATTLENET_AUTH_FAILED and other codes", () => {
    expect(battleNetFlashMessage(error("BATTLENET_AUTH_FAILED"))?.text).toBe(
      "Battle.net connection failed (BATTLENET_AUTH_FAILED).",
    );
    expect(battleNetFlashMessage(error("BATTLENET_STATE_INVALID"))?.text).toBe(
      "Battle.net connection failed (BATTLENET_STATE_INVALID).",
    );
    expect(battleNetFlashMessage(error(null))?.text).toBe("Battle.net connection failed.");
  });

  it("keeps the existing expired-session and connected messages", () => {
    expect(battleNetFlashMessage(error("BATTLENET_IMPORT_SESSION_EXPIRED"))?.text).toBe(
      "Battle.net character selection expired. Reconnect to refresh your owned characters.",
    );
    expect(battleNetFlashMessage({ status: "connected", region: "EU", code: null, linked: 2 })).toEqual({
      tone: "success",
      text: "Battle.net connected (EU). Linked 2 existing characters automatically. Use Import to choose further characters.",
    });
    expect(battleNetFlashMessage({ status: null, region: null, code: null, linked: 0 })).toBeNull();
  });
});

describe("battleNetErrorFlashCleanUrl", () => {
  it("drops only the Battle.net flash parameters from an error URL, keeping others and the hash", () => {
    expect(
      battleNetErrorFlashCleanUrl(
        "https://hub.test/characters?battlenet=error&code=BATTLENET_ACCOUNT_PROFILE_FORBIDDEN&filter=all#list",
      ),
    ).toBe("/characters?filter=all#list");
    expect(
      battleNetErrorFlashCleanUrl("https://hub.test/characters?battlenet=error&code=BATTLENET_AUTH_FAILED&region=EU&linked=0"),
    ).toBe("/characters");
  });

  it("leaves success and flash-free URLs alone (null = nothing to clean)", () => {
    expect(battleNetErrorFlashCleanUrl("https://hub.test/characters?battlenet=connected&region=EU&importSession=x")).toBeNull();
    expect(battleNetErrorFlashCleanUrl("https://hub.test/characters?filter=all")).toBeNull();
    expect(battleNetErrorFlashCleanUrl("https://hub.test/characters")).toBeNull();
  });
});
