import type { RunListRecord } from "@/repositories/run.repository";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { CreateRunInput, UpdateRunInput } from "@/validators/run";

export function futureTestIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Default Venomous product shape for runService.createRun in integration tests. */
export function venomousCreateInput(
  overrides: Partial<CreateRunInput> & Record<string, unknown> = {},
): CreateRunInput {
  const { plannedBossCount, ...rest } = overrides;
  const venomousPlannedBossCount =
    typeof plannedBossCount === "number"
      ? plannedBossCount
      : ((rest as { venomousPlannedBossCount?: number }).venomousPlannedBossCount ?? 8);
  return {
    contentPreset: "VENOMOUS_ABYSS",
    venomousPlannedBossCount,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: futureTestIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    ...rest,
  } as CreateRunInput;
}

/** Update payload preserving current Venomous content via contentPreset. */
export function venomousUpdateInput(
  runId: string,
  run: RunListRecord,
  overrides: Partial<UpdateRunInput> & Record<string, unknown> = {},
): UpdateRunInput {
  const venomousRow = run.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID);
  const { plannedBossCount, ...rest } = overrides;
  const venomousPlannedBossCount =
    typeof plannedBossCount === "number"
      ? plannedBossCount
      : (venomousRow?.plannedBossCount ?? 8);
  return {
    runId,
    contentPreset: "VENOMOUS_ABYSS",
    venomousPlannedBossCount,
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
