import { DomainError } from "@/lib/errors";
import type { AttendanceStatus } from "@/models/enums";

export const FULL_SHARE_UNITS = 100;
export const SHARE_UNITS_MIN = 0;
export const SHARE_UNITS_MAX = 10_000;
/** Inclusive upper bound for PostgreSQL signed integer gold totals. */
export const TOTAL_GOLD_MIN = 1;
export const TOTAL_GOLD_MAX = 2_000_000_000;
export const PAYOUT_ADJUSTMENT_REASON_MAX = 200;

export const DEFAULT_ATTENDANCE_SHARE_UNITS = {
  PRESENT: 100,
  LATE: 100,
  LEFT_EARLY: 100,
  NO_SHOW: 0,
  EXCUSED: 0,
  STANDBY: 0,
} as const satisfies Record<Exclude<AttendanceStatus, "UNMARKED">, number>;

export function defaultShareUnits(status: AttendanceStatus): number {
  if (status === "UNMARKED") {
    throw new DomainError(
      "PAYOUT_ATTENDANCE_INVALID",
      "A completed run cannot have unmarked attendance.",
    );
  }
  return DEFAULT_ATTENDANCE_SHARE_UNITS[status];
}

export function assertShareUnits(value: number): number {
  if (!Number.isInteger(value) || value < SHARE_UNITS_MIN || value > SHARE_UNITS_MAX) {
    throw new DomainError(
      "PAYOUT_INVALID_SHARE",
      `Share units must be a whole number from ${SHARE_UNITS_MIN} to ${SHARE_UNITS_MAX}.`,
    );
  }
  return value;
}

export function assertTotalGold(value: number): number {
  if (!Number.isInteger(value) || value < TOTAL_GOLD_MIN || value > TOTAL_GOLD_MAX) {
    throw new DomainError(
      "PAYOUT_INVALID_TOTAL",
      `Total gold must be a whole number from ${TOTAL_GOLD_MIN.toLocaleString("en-US")} to ${TOTAL_GOLD_MAX.toLocaleString("en-US")}.`,
    );
  }
  return value;
}

export function noteAdjustmentReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
