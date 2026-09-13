import { DomainError } from "@/lib/errors";
import type { RaidLeadCutMode } from "@/models/enums";
import { RAID_LEAD_CUT_MODES } from "@/models/enums";
import { assertTotalGold } from "@/services/payout-state";

export type ShareInput = {
  attendanceId: string;
  shareUnits: number;
};

export type GoldAllocation = {
  attendanceId: string;
  shareUnits: number;
  amountGold: number;
};

export type SettlementPoolInput = {
  totalGold: number;
  raidLeadCutMode: RaidLeadCutMode;
  raidLeadCutGold: number;
  entries: ShareInput[];
};

export type SettlementPoolResult = {
  finalPot: number;
  declaredRaidLeadCut: number;
  raidLeadCutMode: RaidLeadCutMode;
  dedicatedRaidLeadPayout: number;
  distributablePool: number;
  attendancePayouts: GoldAllocation[];
  allocatedAttendanceGold: number;
  totalAllocatedGold: number;
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

export function assertRaidLeadCutMode(value: string): RaidLeadCutMode {
  if (!(RAID_LEAD_CUT_MODES as readonly string[]).includes(value)) {
    throw new DomainError("PAYOUT_INVALID_CUT_MODE", "Raid Lead cut mode must be KEEP or SHARE.");
  }
  return value as RaidLeadCutMode;
}

/**
 * Declared Raid Lead cut. Allowed for both KEEP and SHARE.
 * Must be a non-negative integer strictly less than totalGold when positive.
 */
export function assertRaidLeadCutGold(cutGold: number, totalGold: number): number {
  if (!Number.isInteger(cutGold) || cutGold < 0) {
    throw new DomainError(
      "PAYOUT_INVALID_RAID_LEAD_CUT",
      "Raid Lead cut must be a whole number greater than or equal to zero.",
    );
  }
  if (cutGold >= totalGold) {
    throw new DomainError(
      "PAYOUT_INVALID_RAID_LEAD_CUT",
      "Raid Lead cut must be less than the final pot.",
    );
  }
  return cutGold;
}

/**
 * Settlement pool math for KEEP / SHARE.
 *
 * KEEP: dedicated cut is deducted; attendance allocates the remaining pool.
 * SHARE: declared cut is retained for audit only; attendance allocates the full pot.
 *
 * Conservation:
 * - KEEP: allocatedAttendanceGold + dedicatedRaidLeadPayout === totalGold
 * - SHARE: allocatedAttendanceGold === totalGold (dedicatedRaidLeadPayout === 0)
 */
export function calculateSettlementPool(input: SettlementPoolInput): SettlementPoolResult {
  const finalPot = assertTotalGold(input.totalGold);
  const raidLeadCutMode = assertRaidLeadCutMode(input.raidLeadCutMode);
  const declaredRaidLeadCut = assertRaidLeadCutGold(input.raidLeadCutGold, finalPot);
  const dedicatedRaidLeadPayout = raidLeadCutMode === "KEEP" ? declaredRaidLeadCut : 0;
  const distributablePool = finalPot - dedicatedRaidLeadPayout;
  const attendancePayouts = allocateGold(distributablePool, input.entries);
  const allocatedAttendanceGold = attendancePayouts.reduce((sum, row) => sum + row.amountGold, 0);
  const totalAllocatedGold = allocatedAttendanceGold + dedicatedRaidLeadPayout;

  if (allocatedAttendanceGold !== distributablePool) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Calculated participant gold does not equal the distributable pool.");
  }
  if (totalAllocatedGold !== finalPot) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Calculated gold does not equal the settlement total.");
  }

  return {
    finalPot,
    declaredRaidLeadCut,
    raidLeadCutMode,
    dedicatedRaidLeadPayout,
    distributablePool,
    attendancePayouts,
    allocatedAttendanceGold,
    totalAllocatedGold,
  };
}

function compareAttendanceId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
