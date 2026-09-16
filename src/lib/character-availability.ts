/**
 * Manual Character availability blocks use a half-open interval [startsAt, endsAt).
 * A BoostingHub Run conflicts when its scheduled start falls inside that window.
 * This is independent of CROSS_RUN_RESERVATION_MIN_GAP_MS (±2h padding is never applied).
 */

export type AvailabilityInterval = {
  startsAt: string;
  endsAt: string;
};

/** Candidate used when choosing among overlapping covering blocks. */
export type AvailabilityBlockCandidate = AvailabilityInterval & {
  id?: string;
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

/**
 * Stable precedence among covering blocks:
 * 1. earliest startsAt
 * 2. earliest endsAt
 * 3. lexical id (missing id sorts as "")
 *
 * Independent of input / repository row order. Does not mutate `blocks`.
 */
export function compareAvailabilityBlockPrecedence(
  a: AvailabilityBlockCandidate,
  b: AvailabilityBlockCandidate,
): number {
  const startDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  if (startDiff !== 0) {
    return startDiff;
  }
  const endDiff = new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
  if (endDiff !== 0) {
    return endDiff;
  }
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Filters to blocks covering the Run start, then picks the deterministic winner.
 * Overlaps remain allowed; only the surfaced block is chosen.
 */
export function findBlockingAvailabilityBlock<T extends AvailabilityBlockCandidate>(
  runStartAt: string | Date | number,
  blocks: readonly T[],
): T | null {
  let winner: T | null = null;
  for (const block of blocks) {
    if (!runStartFallsInAvailabilityBlock(runStartAt, block)) {
      continue;
    }
    if (!winner || compareAvailabilityBlockPrecedence(block, winner) < 0) {
      winner = block;
    }
  }
  return winner;
}

/** Blocks that have not ended yet (endsAt > now). Past blocks stay stored but are ignored for signup. */
export function isAvailabilityBlockCurrentOrUpcoming(
  block: AvailabilityInterval,
  now: Date | string | number = Date.now(),
): boolean {
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  return new Date(block.endsAt).getTime() > nowMs;
}
