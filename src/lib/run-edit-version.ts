import { createHash } from "node:crypto";
import { DomainError } from "@/lib/errors";

export type RunEditVersionInput = {
  scheduledStartAt: string;
  difficulty: string;
  lootType: string;
  raidLeadId: string;
  notes: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  discordRolePing: boolean;
  contents: ReadonlyArray<{ raidId: string; sortOrder: number; plannedBossCount: number }>;
};

/**
 * Identity of everything the Edit Run form shows. Save is refused when it
 * differs from the version the form opened with, so a stale form cannot undo
 * another manager's edit. Only these fields count: signups, roster progress,
 * lifecycle and a Raid Lead rename do not invalidate an open form.
 */
export function runEditVersion(run: RunEditVersionInput): string {
  const contents = [...run.contents]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => [row.raidId, row.sortOrder, row.plannedBossCount]);
  const identity = JSON.stringify([
    Date.parse(run.scheduledStartAt),
    run.difficulty,
    run.lootType,
    run.raidLeadId,
    run.notes,
    run.desiredTankCount,
    run.desiredHealerCount,
    run.desiredDpsCount,
    run.desiredLootbuddyCount,
    run.discordRolePing,
    contents,
  ]);
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

export function runEditStaleError(): DomainError {
  return new DomainError(
    "RUN_EDIT_STALE",
    "Someone else changed this run after you opened the form. Your changes were not saved — reload to see the current version.",
    409,
  );
}
