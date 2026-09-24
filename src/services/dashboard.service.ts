import type { AuthenticatedUser } from "@/auth/authorization";
import { hasAdminAccess, hasRaidLeadAccess } from "@/auth/authorization";
import { UPCOMING_RUN_STATUSES } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { characterRepository } from "@/repositories/character.repository";
import { runRepository } from "@/repositories/run.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import {
  projectDashboardOperations,
  projectPersonalDashboardAttention,
} from "@/services/dashboard-attention";
import { lockoutService } from "@/services/lockout.service";
import { listManagedRunOperationalHandoffs } from "@/services/managed-run-operational.service";
import { isSignupWindowOpen } from "@/services/run-state";
import { signupService } from "@/services/signup.service";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";

/**
 * Role-aware operational attention Dashboard.
 * Personal state reuses signupService.getMyRuns; managed ops reuse shared handoff batching.
 */
export const dashboardService = {
  async getDashboard(user: AuthenticatedUser) {
    const showOperations = hasRaidLeadAccess(user.accountRole);
    const isAdmin = hasAdminAccess(user.accountRole);

    const [runs, myRuns, characters, activity, managedOps] = await Promise.all([
      runRepository.listUpcoming(),
      signupService.getMyRuns(user),
      characterRepository.listByUserId(user.id),
      // Community-wide operational events are for Raid Leads and Admins only.
      showOperations ? activityRepository.listRecent() : Promise.resolve([]),
      showOperations ? listManagedRunOperationalHandoffs(user) : Promise.resolve([]),
    ]);

    const personal = projectPersonalDashboardAttention(myRuns);
    const { operations, adminMarkPaid } = projectDashboardOperations({
      rows: managedOps,
      includeRosterWork: true,
      adminOnlyMarkPaid: isAdmin,
    });

    const upcomingRuns = runs.filter((run) => UPCOMING_RUN_STATUSES.includes(run.status));

    const approvedCharacterIds = new Set(
      characters
        .filter((character) =>
          boosterQualificationService.summarize(character.boosterQualifications).approvedCount > 0,
        )
        .map((character) => character.id),
    );

    const currentRaidIds = new Set(getCurrentLockoutRaids().map((raid) => raid.id));
    const lockoutAttention = characters.flatMap((character) => {
      const currentReset = getRegionalWeeklyReset(character.region).resetIdentifier;
      return lockoutService
        .summarize(
          character.lockouts.filter(
            (lockout) =>
              lockout.resetIdentifier === currentReset && currentRaidIds.has(lockout.raidId),
          ),
        )
        .filter((lockout) => lockout.attention)
        .map((lockout) => ({
          characterName: character.name,
          ...lockout,
        }));
    });

    return {
      personal,
      operations: showOperations ? operations : [],
      adminMarkPaid: isAdmin ? adminMarkPaid : [],
      showOperations,
      isAdmin,
      upcomingRuns: upcomingRuns.map((run) => ({
        id: run.id,
        title: run.title,
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        difficulty: run.difficulty,
        scheduledStartAt: run.scheduledStartAt,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
        status: run.status,
      })),
      characters: {
        activeCount: characters.filter((character) => character.isActive).length,
        totalCount: characters.length,
        boosterEligibleCount: approvedCharacterIds.size,
        lockoutAttentionCount: lockoutAttention.length,
        lockoutAttention,
      },
      showRecentActivity: showOperations,
      recentActivity: activity.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        occurredAt: event.occurredAt,
        actorName: event.user?.name ?? "System",
      })),
    };
  },
};
