import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun, hasAdminAccess, hasRaidLeadAccess } from "@/auth/authorization";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { payoutRepository } from "@/repositories/payout.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import {
  projectRunOperationalHandoff,
  type RunOperationalHandoff,
  type RunSettlementStage,
} from "@/services/run-operational-handoff";
import {
  emptyRunCapabilities,
  getRunLifecycleCapabilities,
  type RunLifecycleCapabilities,
} from "@/services/run-state";

export type ManagedRunOperationalProjection = {
  run: RunListRecord;
  capabilities: RunLifecycleCapabilities;
  handoff: RunOperationalHandoff;
};

function capabilitiesForManagedRun(
  user: AuthenticatedUser,
  run: RunListRecord,
): RunLifecycleCapabilities {
  if (!canManageRun(user, run)) {
    return emptyRunCapabilities();
  }
  return getRunLifecycleCapabilities({
    status: run.status,
    signupsOpen: run.signupsOpen,
    actorIsAdmin: hasAdminAccess(user.accountRole),
    archivedAt: run.archivedAt,
  });
}

/**
 * Batched attendance + settlement + handoff projection for already-authorized managed Runs.
 * One attendance summary query and one settlement status query for the whole set.
 */
export async function projectManagedRunHandoffs(
  user: AuthenticatedUser,
  runs: RunListRecord[],
): Promise<ManagedRunOperationalProjection[]> {
  if (runs.length === 0) {
    return [];
  }
  const runIds = runs.map((run) => run.id);
  const [attendanceByRunId, settlementByRunId] = await Promise.all([
    attendanceRepository.summarizeByRunIds(runIds),
    payoutRepository.listStatusByRunIds(runIds),
  ]);
  const canMarkPaid = hasAdminAccess(user.accountRole);

  return runs.map((run) => {
    const capabilities = capabilitiesForManagedRun(user, run);
    const attendance = attendanceByRunId.get(run.id) ?? { total: 0, unmarkedCount: 0 };
    const settlementStage: RunSettlementStage = settlementByRunId.get(run.id) ?? "NONE";
    const handoff = projectRunOperationalHandoff({
      status: run.status,
      hasRoster: Boolean(run.roster),
      publishedAt: run.roster?.publishedAt ?? null,
      draftSelectedCount: run.roster?.draftSelectedCount ?? 0,
      capabilities,
      attendance,
      settlementStage,
      canMarkPaid,
    });
    return { run, capabilities, handoff };
  });
}

/**
 * Active (non-archived) Runs the actor can manage, with operational handoffs.
 * Empty for USER. Reused by Manage hub and Dashboard.
 */
export async function listManagedRunOperationalHandoffs(
  user: AuthenticatedUser,
): Promise<ManagedRunOperationalProjection[]> {
  if (!hasRaidLeadAccess(user.accountRole)) {
    return [];
  }
  const runs = await runRepository.listManaged();
  const managed = runs.filter((run) => canManageRun(user, run) && !run.archivedAt);
  return projectManagedRunHandoffs(user, managed);
}
