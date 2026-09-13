import { DomainError } from "@/lib/errors";
import type { RaidLeadCutMode } from "@/models/enums";
import { RAID_LEAD_CUT_MODES } from "@/models/enums";
import { RAID_LEAD_CUT_SHARE_UNITS, assertTotalGold } from "@/services/payout-state";

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
  entries: ShareInput[];
};

export type SettlementPoolResult = {
  totalGold: number;
  raidLeadCutMode: RaidLeadCutMode;
  raidLeadCutShareUnits: number;
  dedicatedRaidLeadPayout: number;
  attendanceUnits: number;
  totalSettlementUnits: number;
  attendancePayouts: GoldAllocation[];
  attendanceDistributedGold: number;
  totalAllocatedGold: number;
};

/** Calculation-only key for the KEEP extra Raid Lead share. Never a real attendance id. */
export const RAID_LEAD_CUT_ALLOCATION_KEY = "__raid_lead_cut__";

/**
 * Deterministic integer gold allocation.
 *
 * 1. totalUnits = sum of shareUnits > 0
 * 2. each eligible entry gets floor(totalGold * shareUnits / totalUnits)
 * 3. remaining gold is given one unit at a time in allocation-key lexicographic order
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
    .sort((a, b) => compareAllocationKey(a.attendanceId, b.attendanceId));

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
 * Settlement math for KEEP / SHARE.
 *
 * KEEP adds one calculation-only full share (`RAID_LEAD_CUT_SHARE_UNITS`) into the same
 * weighted allocation as attendance shares. That synthetic share is never persisted as
 * attendance. SHARE allocates only attendance units.
 *
 * Remainder ordering: lexicographic on allocation keys, so the KEEP pseudo-key
 * (`RAID_LEAD_CUT_ALLOCATION_KEY`) participates in the same deterministic remainder pass.
 *
 * Conservation: attendanceDistributedGold + dedicatedRaidLeadPayout === totalGold
 */
export function calculateSettlementPool(input: SettlementPoolInput): SettlementPoolResult {
  const totalGold = assertTotalGold(input.totalGold);
  const raidLeadCutMode = assertRaidLeadCutMode(input.raidLeadCutMode);
  const attendanceUnits = input.entries.reduce(
    (sum, entry) => sum + (entry.shareUnits > 0 ? entry.shareUnits : 0),
    0,
  );
  const raidLeadCutShareUnits = raidLeadCutMode === "KEEP" ? RAID_LEAD_CUT_SHARE_UNITS : 0;
  const totalSettlementUnits = attendanceUnits + raidLeadCutShareUnits;

  if (totalSettlementUnits <= 0) {
    throw new DomainError(
      "PAYOUT_NO_ELIGIBLE_SHARES",
      "At least one participant must have share units greater than zero.",
    );
  }

  const allocationEntries: ShareInput[] = [
    ...input.entries,
    ...(raidLeadCutShareUnits > 0
      ? [{ attendanceId: RAID_LEAD_CUT_ALLOCATION_KEY, shareUnits: raidLeadCutShareUnits }]
      : []),
  ];
  const allocated = allocateGold(totalGold, allocationEntries);
  const dedicatedRaidLeadPayout =
    allocated.find((row) => row.attendanceId === RAID_LEAD_CUT_ALLOCATION_KEY)?.amountGold ?? 0;
  const attendancePayouts = allocated.filter((row) => row.attendanceId !== RAID_LEAD_CUT_ALLOCATION_KEY);
  const attendanceDistributedGold = attendancePayouts.reduce((sum, row) => sum + row.amountGold, 0);
  const totalAllocatedGold = attendanceDistributedGold + dedicatedRaidLeadPayout;

  if (totalAllocatedGold !== totalGold) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Calculated gold does not equal the settlement total.");
  }

  return {
    totalGold,
    raidLeadCutMode,
    raidLeadCutShareUnits,
    dedicatedRaidLeadPayout,
    attendanceUnits,
    totalSettlementUnits,
    attendancePayouts,
    attendanceDistributedGold,
    totalAllocatedGold,
  };
}

function compareAllocationKey(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
