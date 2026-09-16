/**
 * Manual Character availability blocks use a half-open interval [startsAt, endsAt).
 * A BoostingHub Run conflicts when its scheduled start falls inside that window.
 * This is independent of CROSS_RUN_RESERVATION_MIN_GAP_MS (±2h padding is never applied).
 */

export type AvailabilityInterval = {
  startsAt: string;
  endsAt: string;
};

export function assertValidAvailabilityInterval(startsAt: string, endsAt: string): void {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new RangeError("Availability timestamps must be valid ISO instants.");
  }
  if (endMs <= startMs) {
    throw new RangeError("Availability end must be after start.");
  }
}

/** Half-open: startsAt inclusive, endsAt exclusive. */
export function runStartFallsInAvailabilityBlock(
  runStartAt: string | Date | number,
  block: AvailabilityInterval,
): boolean {
  const runMs =
    typeof runStartAt === "number" ? runStartAt : new Date(runStartAt).getTime();
  const startMs = new Date(block.startsAt).getTime();
  const endMs = new Date(block.endsAt).getTime();
  return startMs <= runMs && runMs < endMs;
}

export function findBlockingAvailabilityBlock<T extends AvailabilityInterval>(
  runStartAt: string | Date | number,
  blocks: readonly T[],
): T | null {
  for (const block of blocks) {
    if (runStartFallsInAvailabilityBlock(runStartAt, block)) {
      return block;
    }
  }
  return null;
}

/** Blocks that have not ended yet (endsAt > now). Past blocks stay stored but are ignored for signup. */
export function isAvailabilityBlockCurrentOrUpcoming(
  block: AvailabilityInterval,
  now: Date | string | number = Date.now(),
): boolean {
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  return new Date(block.endsAt).getTime() > nowMs;
}
