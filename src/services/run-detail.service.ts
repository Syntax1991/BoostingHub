import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { runRepository } from "@/repositories/run.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { userRepository } from "@/repositories/user.repository";
import { emptyRunCapabilities, getRunLifecycleCapabilities, isSignupWindowOpen } from "@/services/run-state";
import { hasAdminAccess } from "@/auth/authorization";
import { attendanceService } from "@/services/attendance.service";
import { payoutService } from "@/services/payout.service";
import { rosterService, type RosterManagementView } from "@/services/roster.service";
import { signupService } from "@/services/signup.service";

function canViewRunDetail(
  user: AuthenticatedUser,
  run: { status: string; raidLeadId: string },
  hasOwnSignupHistory: boolean,
  manage: boolean,
): boolean {
  if (manage) {
    return true;
  }
  if (run.status === "DRAFT") {
    return false;
  }
  if (run.status === "CANCELLED") {
    return hasOwnSignupHistory;
  }
  return true;
}

/**
 * Viewer-specific Run detail. USER payloads omit manager roster/signup state
 * entirely — hiding buttons is not the authorization boundary.
 */
export const runDetailService = {
  async getRunDetail(user: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const manage = canManageRun(user, run);
    const viewerSignups = await signupService.listOwnForRun(user, runId);
    if (!canViewRunDetail(user, run, viewerSignups.length > 0, manage)) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const publishedRoster = await rosterService.getPublishedRosterView(runId);
    const activeSignups = run.signups.filter((signup) => signup.status !== "WITHDRAWN");
    const selectedCount = run.signups.filter((signup) => signup.status === "SELECTED").length;
    const activeOwn = viewerSignups.filter((signup) => signup.status !== "WITHDRAWN");
    const hasSignupHistory = run.signups.length > 0;
    const capabilities = manage
      ? getRunLifecycleCapabilities({
          status: run.status,
          signupsOpen: run.signupsOpen,
          hasSignupHistory,
          actorIsAdmin: hasAdminAccess(user.accountRole),
        })
      : emptyRunCapabilities();

    const header = {
      id: run.id,
      title: run.title,
      raidId: run.raidId,
      raidName: run.raidName,
      season: run.season,
      difficulty: run.difficulty,
      scheduledStartAt: run.scheduledStartAt,
      status: run.status,
      raidLeadId: run.raidLeadId,
      raidLeadName: run.raidLeadName,
      notes: run.notes,
      signupsOpen: run.signupsOpen,
      signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
      desiredTankCount: run.desiredTankCount,
      desiredHealerCount: run.desiredHealerCount,
      desiredDpsCount: run.desiredDpsCount,
      activeSignupCount: activeSignups.length,
      selectedCount,
    };

    let manager: RosterManagementView | null = null;
    if (manage) {
      manager = await rosterService.getRosterManagementView(user, runId);
    }

    const ownAttendance = manage ? [] : await attendanceService.getOwnAttendance(user, runId);
    const managerAttendance = manage ? await attendanceService.getManagerAttendance(user, runId) : null;
    const payout = await payoutService.getPayoutView(user, runId);

    let editor: {
      hasSignupHistory: boolean;
      canAssignRaidLead: boolean;
      raids: Array<{ id: string; name: string; season: string }>;
      raidLeads: Array<{ id: string; name: string }>;
    } | null = null;

    if (manage && capabilities.canEdit) {
      await raidRepository.ensureReferenceRaids();
      const raids = await raidRepository.listActive();
      const raidLeads = capabilities.canReassignRaidLead
        ? await userRepository.listEligibleRaidLeads()
        : [{ id: run.raidLeadId, name: run.raidLeadName }];
      editor = {
        hasSignupHistory,
        canAssignRaidLead: capabilities.canReassignRaidLead,
        raids,
        raidLeads,
      };
    }

    return {
      run: header,
      overview: {
        ...header,
        participationSummary:
          activeOwn.length === 0
            ? "Not signed"
            : activeOwn
                .map((signup) => `${signup.participationType} · ${signup.status}`)
                .join("; "),
        publishedMemberCount: publishedRoster?.members.length ?? 0,
        hasPublishedRoster: Boolean(publishedRoster),
      },
      permissions: {
        canManageRun: manage,
        canViewManagerSignups: manage,
        canEditRoster: Boolean(manager?.roster.canEdit && !manager.roster.needsPublishSeed),
        canPublishRoster: Boolean(manager?.roster.canEdit && manager.validation.canPublish),
      },
      capabilities,
      editor,
      viewerSignups,
      publishedRoster,
      manager,
      attendance: {
        own: ownAttendance,
        manager: managerAttendance,
      },
      payout,
    };
  },
};

export type RunDetailView = Awaited<ReturnType<typeof runDetailService.getRunDetail>>;
