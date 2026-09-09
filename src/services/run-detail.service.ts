import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { runRepository } from "@/repositories/run.repository";
import { isSignupWindowOpen } from "@/services/run-state";
import { rosterService, type RosterManagementView } from "@/services/roster.service";
import { signupService } from "@/services/signup.service";

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
    const publishedRoster = await rosterService.getPublishedRosterView(runId);
    const activeSignups = run.signups.filter((signup) => signup.status !== "WITHDRAWN");
    const selectedCount = run.signups.filter((signup) => signup.status === "SELECTED").length;
    const activeOwn = viewerSignups.filter((signup) => signup.status !== "WITHDRAWN");

    const header = {
      id: run.id,
      title: run.title,
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
      viewerSignups,
      publishedRoster,
      manager,
    };
  },
};

export type RunDetailView = Awaited<ReturnType<typeof runDetailService.getRunDetail>>;
