import type { AuthenticatedUser } from "@/auth/authorization";
import { UPCOMING_RUN_STATUSES } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { characterRepository } from "@/repositories/character.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { lockoutService } from "@/services/lockout.service";
import { isSignupWindowOpen } from "@/services/run-state";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";

export const dashboardService = {
  async getDashboard(user: AuthenticatedUser) {
    const [runs, mySignups, characters, activity] = await Promise.all([
      runRepository.listUpcoming(),
      signupRepository.listByUserId(user.id),
      characterRepository.listByUserId(user.id),
      activityRepository.listRecent(),
    ]);

    const upcomingRuns = runs.filter((run) => UPCOMING_RUN_STATUSES.includes(run.status));
    const myUpcoming = mySignups.filter(
      (signup) =>
        (signup.status === "PENDING" || signup.status === "SELECTED") &&
        UPCOMING_RUN_STATUSES.includes(signup.run.status),
    );

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
      upcomingRuns: upcomingRuns.map((run) => ({
        id: run.id,
        title: run.title,
        raidName: run.raidName,
        difficulty: run.difficulty,
        scheduledStartAt: run.scheduledStartAt,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
        status: run.status,
      })),
      myUpcomingRuns: myUpcoming.map((signup) => ({
        id: signup.id,
        runId: signup.run.id,
        runTitle: signup.run.title,
        raidName: signup.run.raid.name,
        difficulty: signup.run.difficulty,
        scheduledStartAt: signup.run.scheduledStartAt,
        status: signup.status,
        characterName: signup.character?.name ?? null,
        role: signup.role,
        participationType: signup.participationType,
        isBackup: signup.isBackup,
      })),
      characters: {
        activeCount: characters.filter((character) => character.isActive).length,
        totalCount: characters.length,
        boosterEligibleCount: approvedCharacterIds.size,
        lockoutAttentionCount: lockoutAttention.length,
        lockoutAttention,
      },
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
