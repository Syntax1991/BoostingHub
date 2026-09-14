import { DomainError } from "@/lib/errors";
import type { AttendanceStatus, ParticipationType } from "@/models/enums";

export const FULL_SHARE_UNITS = 100;
export const SHARE_UNITS_MIN = 0;
export const SHARE_UNITS_MAX = 10_000;
/** Inclusive upper bound for PostgreSQL signed integer gold totals. */
export const TOTAL_GOLD_MIN = 1;
export const TOTAL_GOLD_MAX = 2_000_000_000;
export const PAYOUT_ADJUSTMENT_REASON_MAX = 200;

/** 100% = 10_000 basis points. Current Dawn raid settlement policy. */
export const BPS_PER_UNIT = 10_000;
export const BOOSTER_CUT_BPS = 6_250; // 62.5%
export const RAID_LEAD_CUT_BPS = 300; // 3%
export const ADVERTISER_CUT_BPS = 3_000; // 30%
/** Derived residual: 10_000 - 6250 - 300 - 3000 = 450 (4.5%). */
export const DAWN_CUT_BPS = BPS_PER_UNIT - BOOSTER_CUT_BPS - RAID_LEAD_CUT_BPS - ADVERTISER_CUT_BPS;

export const DEFAULT_BOOSTER_ATTENDANCE_SHARE_UNITS = {
  PRESENT: 100,
  LATE: 100,
  LEFT_EARLY: 100,
  NO_SHOW: 0,
  EXCUSED: 0,
  STANDBY: 0,
} as const satisfies Record<Exclude<AttendanceStatus, "UNMARKED">, number>;

/**
 * Default payout share units for a settlement draft row.
 * Lootbuddies default to 0 regardless of attendance or mode; managers may override in DRAFT.
 */
export function defaultShareUnits(input: {
  participationType: ParticipationType;
  attendanceStatus: AttendanceStatus;
}): number {
  if (input.attendanceStatus === "UNMARKED") {
    throw new DomainError(
      "PAYOUT_ATTENDANCE_INVALID",
      "A completed run cannot have unmarked attendance.",
    );
  }
  if (input.participationType === "LOOTBUDDY") {
    return 0;
  }
  return DEFAULT_BOOSTER_ATTENDANCE_SHARE_UNITS[input.attendanceStatus];
}

/** Human-readable Cut label from internal shareUnits (100 = 1.00 Cut). */
export function formatPayoutCut(shareUnits: number): string {
  if (!Number.isInteger(shareUnits) || shareUnits < 0) {
    return "0 Cuts";
  }
  if (shareUnits === 0) {
    return "0 Cuts";
  }
  const cuts = shareUnits / FULL_SHARE_UNITS;
  const formatted = cuts.toFixed(2);
  const label = cuts === 1 || (cuts > 0 && cuts < 1) ? "Cut" : "Cuts";
  return `${formatted} ${label}`;
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
