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
  /** Weekly availability mark for the target Run's reset. */
  skippedUnavailable: number;
  /** Draft-selected or SELECTED on another Run with start gap &lt; 2h. */
  skippedReservationConflict: number;
  skippedInactive: number;
  /**
   * Additive total of hard-ineligible skips (unavailable + reservation conflict
   * + inactive + any residual reason). Prefer the detailed fields for product copy.
   */
  skippedIneligible: number;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/**
 * Concise skip breakdown for Discord / action feedback.
 * Never mentions "saved" — lockouts are not Quick Signup skip reasons.
 */
export function formatQuickSignupSkipSummary(
  result: Pick<
    QuickSignupBoostersResult,
    | "skippedUnavailable"
    | "skippedReservationConflict"
    | "skippedNoDefaultRole"
    | "skippedInactive"
  >,
): string | null {
  const parts: string[] = [];
  if (result.skippedUnavailable > 0) {
    parts.push(plural(result.skippedUnavailable, "unavailable", "unavailable"));
  }
  if (result.skippedReservationConflict > 0) {
    parts.push(
      plural(result.skippedReservationConflict, "scheduling conflict", "scheduling conflicts"),
    );
  }
  if (result.skippedNoDefaultRole > 0) {
    parts.push(plural(result.skippedNoDefaultRole, "missing default role", "missing default roles"));
  }
  if (result.skippedInactive > 0) {
    parts.push(plural(result.skippedInactive, "inactive", "inactive"));
  }
  if (parts.length === 0) return null;
  return `${parts.join(" · ")} skipped`;
}

/** Concise ephemeral / action feedback for Quick Signup outcomes. */
export function formatQuickSignupBoostersMessage(result: QuickSignupBoostersResult): string {
  const skipSummary = formatQuickSignupSkipSummary(result);

  if (result.added > 0) {
    const addedPart =
      result.added === 1
        ? "Signed up with 1 character offered."
        : `Signed up with ${result.added} characters offered.`;
    return skipSummary ? `${addedPart} ${skipSummary}` : addedPart;
  }

  if (result.alreadySigned > 0) {
    const base = "All eligible characters are already signed up.";
    return skipSummary ? `${base} ${skipSummary}` : base;
  }

  if (skipSummary) {
    return `No characters were added. ${skipSummary}`;
  }

  return "No eligible characters to add.";
}
