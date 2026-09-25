/** Background freshness default: Characters older than this are sync candidates. */
export const DEFAULT_STALE_MINUTES = 120;

/**
 * Resolves the stale threshold from BLIZZARD_SYNC_STALE_MINUTES. Missing env
 * deliberately falls back to the documented default (120). A *present but
 * invalid* value (non-numeric, zero, negative, or fractional) fails loudly
 * instead of silently coercing to a default or permitting a 0-minute
 * busy-loop threshold — a misconfigured production env should be visible,
 * not quietly hammer Blizzard every cycle.
 *
 * This threshold is independent of the external scheduler tick (~15 minutes)
 * and of the manual Refresh cooldown (~60 seconds).
 */
export function resolveScheduledSyncStaleMs(): number {
  const raw = process.env.BLIZZARD_SYNC_STALE_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_STALE_MINUTES * 60_000;
  }

  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(
      `BLIZZARD_SYNC_STALE_MINUTES must be a positive integer (got "${raw}"). ` +
        "Unset it to use the default of 120 minutes.",
    );
  }

  return minutes * 60_000;
}
