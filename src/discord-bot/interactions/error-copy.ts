import { BotApiError } from "@/discord-bot/bot-api-client";

/**
 * Concise Discord-facing copy for domain error codes. This never invents a
 * new eligibility rule — codes not listed here fall back to the server's own
 * message, which is already written for a human reader.
 */
const MESSAGES: Record<string, string> = {
  SIGNUP_CLOSED: "Signups are closed for this run.",
  CHARACTER_INACTIVE: "One of the selected characters is inactive.",
  LOCKOUT_CONFLICT: "One of the selected characters has a conflicting lockout for this run.",
  BOOSTER_ACCESS_REQUIRED: "You need approved booster access for this run's difficulty.",
  BOOSTER_ACCESS_DIFFICULTY_MISMATCH: "One of the selected characters is not approved for this difficulty.",
  CHARACTER_NOT_OWNED: "One of the selected characters does not belong to you.",
  SIGNUP_OFFER_DUPLICATE_CHARACTER: "The same character was selected twice.",
  SIGNUP_OFFER_ROSTER_SELECTED:
    "A currently selected offer can't be removed — ask the raid lead to change the roster selection first.",
  INVALID_STATE_TRANSITION: "That signup can no longer be changed.",
  INVALID_CHARACTER_ROLE: "One of the selected characters can't be offered in that role.",
  VALIDATION_FAILED: "That selection isn't valid — try again.",
  ACCOUNT_DISABLED: "Your BoostingHub account is disabled.",
};

export function describeBotApiError(error: unknown): string {
  if (error instanceof BotApiError) {
    return MESSAGES[error.code] ?? error.message;
  }
  return "Something went wrong talking to BoostingHub. Try again.";
}
