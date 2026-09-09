import { DomainError } from "@/lib/errors";

export type ShareInput = {
  attendanceId: string;
  shareUnits: number;
};

export type GoldAllocation = {
  attendanceId: string;
  shareUnits: number;
  amountGold: number;
};

/**
 * Deterministic integer gold allocation.
 *
 * 1. totalUnits = sum of shareUnits > 0
 * 2. each eligible entry gets floor(totalGold * shareUnits / totalUnits)
 * 3. remaining gold is given one unit at a time in attendanceId lexicographic order
 *
 * Zero-share entries stay at 0. Same inputs always produce the same output.
 * Invariant: sum(amountGold) === totalGold when totalUnits > 0.
 */
export function allocateGold(totalGold: number, entries: ShareInput[]): GoldAllocation[] {
  if (!Number.isInteger(totalGold) || totalGold <= 0) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Total gold must be a positive whole number.");
  }

  const totalUnits = entries.reduce((sum, entry) => sum + (entry.shareUnits > 0 ? entry.shareUnits : 0), 0);
  if (totalUnits <= 0) {
    throw new DomainError(
      "PAYOUT_NO_ELIGIBLE_SHARES",
      "At least one participant must have share units greater than zero.",
    );
  }

  const amounts = new Map<string, number>();
  for (const entry of entries) {
    amounts.set(entry.attendanceId, 0);
  }

  const eligible = [...entries]
    .filter((entry) => entry.shareUnits > 0)
    .sort((a, b) => compareAttendanceId(a.attendanceId, b.attendanceId));

  let allocated = 0;
  for (const entry of eligible) {
    const floor = Math.floor((totalGold * entry.shareUnits) / totalUnits);
    amounts.set(entry.attendanceId, floor);
    allocated += floor;
  }

  let remainder = totalGold - allocated;
  for (const entry of eligible) {
    if (remainder <= 0) {
      break;
    }
    amounts.set(entry.attendanceId, (amounts.get(entry.attendanceId) ?? 0) + 1);
    remainder -= 1;
  }

  return entries.map((entry) => ({
    attendanceId: entry.attendanceId,
    shareUnits: entry.shareUnits,
    amountGold: amounts.get(entry.attendanceId) ?? 0,
  }));
}

function compareAttendanceId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
