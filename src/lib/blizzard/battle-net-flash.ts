import { REGION_LABELS } from "@/lib/labels";
import type { WowRegion } from "@/models/enums";

/** What the Battle.net connect/callback redirect carries back to `/characters`. */
export type BattleNetFlashInput = {
  status: string | null;
  region: string | null;
  code: string | null;
  linked: number;
};

export type BattleNetFlashMessage = { tone: "success" | "danger"; text: string };

/** The `/characters` banner after a Battle.net connect attempt; null when there is nothing to show. */
export function battleNetFlashMessage(flash: BattleNetFlashInput): BattleNetFlashMessage | null {
  if (flash.status === "connected") {
    const region =
      flash.region && flash.region in REGION_LABELS
        ? REGION_LABELS[flash.region as WowRegion]
        : flash.region;
    const connected = region ? `Battle.net connected (${region}).` : "Battle.net connected.";
    const linked =
      flash.linked > 0
        ? ` Linked ${flash.linked} existing character${flash.linked === 1 ? "" : "s"} automatically.`
        : "";
    return {
      tone: "success",
      text: `${connected}${linked} Use Import to choose further characters.`,
    };
  }
  if (flash.status === "error") {
    if (flash.code === "BATTLENET_IMPORT_SESSION_EXPIRED") {
      return {
        tone: "danger",
        text: "Battle.net character selection expired. Reconnect to refresh your owned characters.",
      };
    }
    if (flash.code === "BATTLENET_ACCOUNT_PROFILE_FORBIDDEN") {
      // Sign-in worked; Blizzard refused this account's character list. Nothing here the
      // user or Manawyrm Hub can fix by retrying, and manual Characters still work.
      return {
        tone: "danger",
        text:
          "Battle.net sign-in succeeded, but Blizzard did not allow access to your WoW character list. " +
          "You can still add characters manually; they will refresh from Blizzard's public profile.",
      };
    }
    return {
      tone: "danger",
      text: flash.code
        ? `Battle.net connection failed (${flash.code}).`
        : "Battle.net connection failed.",
    };
  }
  return null;
}
