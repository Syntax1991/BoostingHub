import { describe, expect, it } from "vitest";
import { battleNetFlashMessage } from "@/lib/blizzard/battle-net-flash";

const error = (code: string | null) => ({ status: "error", region: null, code, linked: 0 });

describe("battleNetFlashMessage", () => {
  it("explains an account-profile denial without calling it a sign-in failure or exposing internals", () => {
    const message = battleNetFlashMessage(error("BATTLENET_ACCOUNT_PROFILE_FORBIDDEN"));
    expect(message).toEqual({
      tone: "danger",
      text:
        "Battle.net sign-in succeeded, but Blizzard did not allow access to your WoW character list. " +
        "You can still add characters manually; they will refresh from Blizzard's public profile.",
    });
    expect(message?.text).not.toMatch(/BATTLENET_|HTTP|403|connection failed|try again/i);
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
