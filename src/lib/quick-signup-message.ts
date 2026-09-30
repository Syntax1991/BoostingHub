/**
 * Shared Quick Signup result DTO + concise product feedback.
 * Kept pure so the Discord bot and Web/service layers can share copy without
 * the bot importing `@/services/*`.
 */

export type QuickSignupBoostersResult = {
  runId: string;
  added: number;
  alreadySigned: number;
  skippedNoDefaultRole: number;
  skippedIneligible: number;
};

/** Concise ephemeral / action feedback for Quick Signup outcomes. */
export function formatQuickSignupBoostersMessage(result: QuickSignupBoostersResult): string {
  if (result.added === 0) {
    if (result.alreadySigned > 0 && result.skippedNoDefaultRole === 0) {
      return "All eligible characters are already signed up.";
    }
    if (result.skippedNoDefaultRole > 0 && result.alreadySigned === 0) {
      return result.skippedNoDefaultRole === 1
        ? "No characters were added. 1 character was skipped because no default role could be determined."
        : `No characters were added. ${result.skippedNoDefaultRole} characters were skipped because no default role could be determined.`;
    }
    if (result.skippedNoDefaultRole > 0) {
      return result.skippedNoDefaultRole === 1
        ? "All eligible characters with a default role are already signed up. 1 character was skipped because no default role could be determined."
        : `All eligible characters with a default role are already signed up. ${result.skippedNoDefaultRole} characters were skipped because no default role could be determined.`;
    }
    return "No eligible characters to add.";
  }

  const addedPart =
    result.added === 1
      ? "Quick Signup added 1 character."
      : `Quick Signup added ${result.added} characters.`;
  if (result.skippedNoDefaultRole === 0) {
    return addedPart;
  }
  const skippedPart =
    result.skippedNoDefaultRole === 1
      ? "1 character was skipped because no default role could be determined."
      : `${result.skippedNoDefaultRole} characters were skipped because no default role could be determined.`;
  return `${addedPart.slice(0, -1)}. ${skippedPart}`;
}
