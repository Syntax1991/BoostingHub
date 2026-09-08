import type { AuthenticatedUser } from "@/auth/authorization";
import type { RaidDifficulty, RunStatus } from "@/models/enums";
import { runRepository } from "@/repositories/run.repository";
import { isSignupWindowOpen } from "@/services/run-state";

export const runService = {
  async listRuns(
    user: AuthenticatedUser,
    filters: { difficulty?: RaidDifficulty; status?: RunStatus } = {},
  ) {
    const runs = await runRepository.listUpcoming(filters);

    return runs.map((run) => {
      const userSignups = run.signups.filter((signup) => signup.userId === user.id);
      const signedCharacters = userSignups
        .filter((signup) => signup.status !== "WITHDRAWN")
        .map((signup) => ({
          id: signup.id,
          status: signup.status,
          participationType: signup.participationType,
          isBackup: signup.isBackup,
        }));

      return {
        id: run.id,
        title: run.title,
        raidName: run.raidName,
        season: run.season,
        difficulty: run.difficulty,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
        signupsOpen: run.signupsOpen,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
        selectedCount: run.signups.filter((signup) => signup.status === "SELECTED").length,
        alreadySigned: signedCharacters.length > 0,
        currentUserSignups: signedCharacters,
        ownSignupCount: signedCharacters.length,
      };
    });
  },
};
