import { DomainError } from "@/lib/errors";

export const DEDUCT_REASON_MAX = 200;
export const DEDUCT_NOTES_MAX = 2000;
export const DEDUCT_REVOKE_REASON_MAX = 500;
/** Matches the payout total-gold upper bound; the real cap per entry is that entry's own gross amount. */
export const DEDUCT_AMOUNT_MAX = 2_000_000_000;

export function assertDeductAmount(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > DEDUCT_AMOUNT_MAX) {
    throw new DomainError(
      "DEDUCT_INVALID_AMOUNT",
      `Deduct amount must be a positive whole number up to ${DEDUCT_AMOUNT_MAX.toLocaleString("en-US")}.`,
    );
  }
  return value;
}
