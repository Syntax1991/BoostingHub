import { DomainError } from "@/lib/errors";
import type { RaidLeadCutMode } from "@/models/enums";
import { RAID_LEAD_CUT_MODES } from "@/models/enums";
import {
  ADVERTISER_CUT_BPS,
  BOOSTER_CUT_BPS,
  BPS_PER_UNIT,
  DAWN_CUT_BPS,
  RAID_LEAD_CUT_BPS,
  assertTotalGold,
} from "@/services/payout-state";

export type ShareInput = {
  attendanceId: string;
  shareUnits: number;
};

export type GoldAllocation = {
  attendanceId: string;
  shareUnits: number;
  amountGold: number;
};

export type SettlementPolicyBps = {
  boosterCutBps: number;
  raidLeadCutBps: number;
  advertiserCutBps: number;
};

export type SettlementPoolInput = {
  totalGold: number;
  raidLeadCutMode: RaidLeadCutMode;
  entries: ShareInput[];
  /** Frozen policy snapshot; defaults to current Dawn raid rates. */
  policy?: SettlementPolicyBps;
};

export type SettlementPoolResult = {
  totalGold: number;
  raidLeadCutMode: RaidLeadCutMode;
  boosterCutBps: number;
  boosterBaseGold: number;
  raidLeadCutBps: number;
  raidLeadCutGold: number;
  advertiserCutBps: number;
  advertiserCutGold: number;
  dawnCutBps: number;
  dawnCutGold: number;
  raidLeadSharedGold: number;
  dedicatedRaidLeadPayout: number;
  distributableBoosterPool: number;
  attendanceUnits: number;
  attendancePayouts: GoldAllocation[];
  attendanceDistributedGold: number;
  /** Attendance payouts + dedicated Raid Lead cut (excludes advertiser/Dawn). */
  totalAllocatedGold: number;
};

export const CURRENT_SETTLEMENT_POLICY: SettlementPolicyBps = {
  boosterCutBps: BOOSTER_CUT_BPS,
  raidLeadCutBps: RAID_LEAD_CUT_BPS,
  advertiserCutBps: ADVERTISER_CUT_BPS,
};

/**
 * Deterministic integer gold allocation across share units.
 *
 * 1. totalUnits = sum of shareUnits > 0
 * 2. each eligible entry gets floor(pool * shareUnits / totalUnits)
 * 3. remaining gold is given one unit at a time in allocation-key lexicographic order
 *
 * Zero-share entries stay at 0. Invariant: sum(amountGold) === pool when totalUnits > 0.
 */
export function allocateGold(pool: number, entries: ShareInput[]): GoldAllocation[] {
  if (!Number.isInteger(pool) || pool < 0) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Payout pool must be a non-negative whole number.");
  }
  if (pool === 0) {
    return entries.map((entry) => ({
      attendanceId: entry.attendanceId,
      shareUnits: entry.shareUnits,
      amountGold: 0,
    }));
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
    const floor = Math.floor((pool * entry.shareUnits) / totalUnits);
    amounts.set(entry.attendanceId, floor);
    allocated += floor;
  }

  let remainder = pool - allocated;
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

export function resolveSettlementPolicy(policy?: SettlementPolicyBps): SettlementPolicyBps {
  return {
    boosterCutBps: policy?.boosterCutBps ?? BOOSTER_CUT_BPS,
    raidLeadCutBps: policy?.raidLeadCutBps ?? RAID_LEAD_CUT_BPS,
    advertiserCutBps: policy?.advertiserCutBps ?? ADVERTISER_CUT_BPS,
  };
}

/**
 * Split gross pot into community buckets. Named buckets use floor; Dawn is the residual.
 * Invariant: booster + raidLead + advertiser + dawn === totalGold.
 */
export function splitGrossPot(totalGold: number, policy: SettlementPolicyBps = CURRENT_SETTLEMENT_POLICY) {
  const gold = assertTotalGold(totalGold);
  const boosterBaseGold = Math.floor((gold * policy.boosterCutBps) / BPS_PER_UNIT);
  const raidLeadCutGold = Math.floor((gold * policy.raidLeadCutBps) / BPS_PER_UNIT);
  const advertiserCutGold = Math.floor((gold * policy.advertiserCutBps) / BPS_PER_UNIT);
  const dawnCutGold = gold - boosterBaseGold - raidLeadCutGold - advertiserCutGold;
  const dawnCutBps = BPS_PER_UNIT - policy.boosterCutBps - policy.raidLeadCutBps - policy.advertiserCutBps;
  return {
    totalGold: gold,
    boosterCutBps: policy.boosterCutBps,
    boosterBaseGold,
    raidLeadCutBps: policy.raidLeadCutBps,
    raidLeadCutGold,
    advertiserCutBps: policy.advertiserCutBps,
    advertiserCutGold,
    dawnCutBps,
    dawnCutGold,
  };
}

/**
 * Dawn raid settlement math.
 *
 * Gross pot → community buckets (62.5% / 3% / 30% / residual Dawn).
 * KEEP: Raid Lead keeps 3%; Booster Pool = booster base only.
 * SHARE: Raid Lead 3% joins Booster Pool; dedicated RL payout = 0.
 * Only the distributable Booster Pool is allocated by attendance shareUnits.
 */
export function calculateSettlementPool(input: SettlementPoolInput): SettlementPoolResult {
  const raidLeadCutMode = assertRaidLeadCutMode(input.raidLeadCutMode);
  const policy = resolveSettlementPolicy(input.policy);
  const buckets = splitGrossPot(input.totalGold, policy);

  const raidLeadSharedGold = raidLeadCutMode === "SHARE" ? buckets.raidLeadCutGold : 0;
  const dedicatedRaidLeadPayout = raidLeadCutMode === "KEEP" ? buckets.raidLeadCutGold : 0;
  const distributableBoosterPool =
    raidLeadCutMode === "SHARE"
      ? buckets.boosterBaseGold + buckets.raidLeadCutGold
      : buckets.boosterBaseGold;

  const attendanceUnits = input.entries.reduce(
    (sum, entry) => sum + (entry.shareUnits > 0 ? entry.shareUnits : 0),
    0,
  );

  if (distributableBoosterPool > 0 && attendanceUnits <= 0) {
    throw new DomainError(
      "PAYOUT_NO_ELIGIBLE_SHARES",
      "At least one participant must have share units greater than zero.",
    );
  }

  const attendancePayouts = allocateGold(distributableBoosterPool, input.entries);
  const attendanceDistributedGold = attendancePayouts.reduce((sum, row) => sum + row.amountGold, 0);

  if (attendanceDistributedGold !== distributableBoosterPool) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Booster pool allocation does not match the distributable pool.");
  }

  if (
    buckets.boosterBaseGold + buckets.raidLeadCutGold + buckets.advertiserCutGold + buckets.dawnCutGold !==
    buckets.totalGold
  ) {
    throw new DomainError("PAYOUT_INVALID_TOTAL", "Community bucket split does not equal the gross pot.");
  }

  return {
    totalGold: buckets.totalGold,
    raidLeadCutMode,
    boosterCutBps: buckets.boosterCutBps,
    boosterBaseGold: buckets.boosterBaseGold,
    raidLeadCutBps: buckets.raidLeadCutBps,
    raidLeadCutGold: buckets.raidLeadCutGold,
    advertiserCutBps: buckets.advertiserCutBps,
    advertiserCutGold: buckets.advertiserCutGold,
    dawnCutBps: buckets.dawnCutBps,
    dawnCutGold: buckets.dawnCutGold,
    raidLeadSharedGold,
    dedicatedRaidLeadPayout,
    distributableBoosterPool,
    attendanceUnits,
    attendancePayouts,
    attendanceDistributedGold,
    totalAllocatedGold: attendanceDistributedGold + dedicatedRaidLeadPayout,
  };
}

function compareAllocationKey(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Re-export for callers that need the residual constant. */
export { DAWN_CUT_BPS };
