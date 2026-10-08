import type { RunListRecord } from "@/repositories/run.repository";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import {
  MIDNIGHT_S2_BUNDLE_PRODUCT_ID,
  MIDNIGHT_S2_BUNDLE_VENOMOUS_CONTENT_ID,
  VENOMOUS_ABYSS_PRODUCT_CONTENT_ID,
  VENOMOUS_ABYSS_PRODUCT_ID,
} from "@/lib/product-catalog";
import type { CreateRunInput, UpdateRunInput } from "@/validators/run";

/** Seeded product keys used by integration fixtures (test-only convenience — never a runtime allowlist). */
export type SeededProductKey = "VENOMOUS_ABYSS" | "MIDNIGHT_S2_BUNDLE";

/**
 * Product selection payload for a seeded product: `productId` + the Venomous
 * VARIABLE count keyed by that product's content id (Tide stays server-forced).
 */
export function seededProductSelection(
  key: SeededProductKey,
  venomousPlannedBossCount = 8,
): { productId: string; contentBossCounts: Record<string, number> } {
  return key === "VENOMOUS_ABYSS"
    ? {
        productId: VENOMOUS_ABYSS_PRODUCT_ID,
        contentBossCounts: { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: venomousPlannedBossCount },
      }
    : {
        productId: MIDNIGHT_S2_BUNDLE_PRODUCT_ID,
        contentBossCounts: { [MIDNIGHT_S2_BUNDLE_VENOMOUS_CONTENT_ID]: venomousPlannedBossCount },
      };
}

export function futureTestIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Default Venomous product shape for runService.createRun in integration tests. */
export function venomousCreateInput(
  overrides: Partial<CreateRunInput> & Record<string, unknown> = {},
): CreateRunInput {
  const { plannedBossCount, venomousPlannedBossCount: venomousOverride, ...rest } = overrides as typeof overrides & {
    venomousPlannedBossCount?: number;
  };
  const venomousPlannedBossCount =
    typeof plannedBossCount === "number" ? plannedBossCount : (venomousOverride ?? 8);
  return {
    ...seededProductSelection("VENOMOUS_ABYSS", venomousPlannedBossCount),
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: futureTestIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    ...rest,
  } as CreateRunInput;
}

/** Update payload re-selecting the seeded Venomous product (keeps or changes its boss count). */
export function venomousUpdateInput(
  runId: string,
  run: RunListRecord,
  overrides: Partial<UpdateRunInput> & Record<string, unknown> = {},
): UpdateRunInput {
  const venomousRow = run.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID);
  const { plannedBossCount, venomousPlannedBossCount: venomousOverride, ...rest } = overrides as typeof overrides & {
    venomousPlannedBossCount?: number;
  };
  const venomousPlannedBossCount =
    typeof plannedBossCount === "number"
      ? plannedBossCount
      : (venomousOverride ?? venomousRow?.plannedBossCount ?? 8);
  return {
    runId,
    ...seededProductSelection("VENOMOUS_ABYSS", venomousPlannedBossCount),
    difficulty: run.difficulty,
    lootType: run.lootType,
    scheduledStartAt: run.scheduledStartAt,
    notes: run.notes,
    desiredTankCount: run.desiredTankCount,
    desiredHealerCount: run.desiredHealerCount,
    desiredDpsCount: run.desiredDpsCount,
    ...rest,
  } as UpdateRunInput;
}

/** Legacy explicit raidId + plannedBossCount update (custom / historical contents). */
export function contentLegacyUpdateInput(
  runId: string,
  run: RunListRecord,
  overrides: Partial<UpdateRunInput> & Record<string, unknown> = {},
): UpdateRunInput {
  const primary = run.contents.find((row) => row.sortOrder === 1) ?? run.contents[0]!;
  const { plannedBossCount, raidId, ...rest } = overrides;
  return {
    runId,
    raidId: (raidId as string | undefined) ?? primary.raidId,
    plannedBossCount:
      typeof plannedBossCount === "number" ? plannedBossCount : primary.plannedBossCount,
    difficulty: run.difficulty,
    lootType: run.lootType,
    scheduledStartAt: run.scheduledStartAt,
    notes: run.notes,
    desiredTankCount: run.desiredTankCount,
    desiredHealerCount: run.desiredHealerCount,
    desiredDpsCount: run.desiredDpsCount,
    ...rest,
  } as UpdateRunInput;
}

export function venomousPlannedFromRun(run: RunListRecord | null | undefined): number {
  return (
    run?.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)?.plannedBossCount ??
    run?.contents[0]?.plannedBossCount ??
    0
  );
}

export function primaryRaidIdFromRun(run: RunListRecord | null | undefined): string | undefined {
  return run?.contents.find((row) => row.sortOrder === 1)?.raidId ?? run?.contents[0]?.raidId;
}
