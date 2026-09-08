import type { AuthenticatedUser } from "@/auth/authorization";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
} from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { resetIdentifierFor } from "@/lib/datetime";
import { activityRepository } from "@/repositories/activity.repository";
import { characterRepository } from "@/repositories/character.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import {
  assertSignupWindowOpen,
  evaluateBoosterOptions,
  evaluateLootbuddyOptions,
} from "@/services/signup-eligibility";
import { assertSignupTransition, canSelfWithdrawSignup, isBlockingDuplicate } from "@/services/signup-state";

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

/**
 * User-side run signup. BOOSTER and LOOTBUDDY are per-run participation types,
 * not account identities. Roster selection remains a later phase.
 */
export const signupService = {
  async getMyRuns(user: AuthenticatedUser) {
    const signups = await signupRepository.listByUserId(user.id);

    const items = signups.map((signup) => ({
      id: signup.id,
      runId: signup.run.id,
      runTitle: signup.run.title,
      raidName: signup.run.raid.name,
      difficulty: signup.run.difficulty,
      scheduledStartAt: signup.run.scheduledStartAt,
      runStatus: signup.run.status,
      characterName: signup.character?.name ?? null,
      characterRealm: signup.character?.realm ?? null,
      role: signup.role,
      participationType: signup.participationType,
      isBackup: signup.isBackup,
      status: signup.status,
      lootbuddyMode: signup.lootbuddyMode,
      lootbuddyVerification: signup.lootbuddyVerification,
      canWithdraw: signup.userId === user.id && canSelfWithdrawSignup(signup.status, signup.run.status),
    }));

    return {
      pending: items.filter((item) => item.status === "PENDING"),
      selected: items.filter((item) => item.status === "SELECTED"),
      notSelected: items.filter((item) => item.status === "NOT_SELECTED"),
      withdrawn: items.filter((item) => item.status === "WITHDRAWN"),
    };
  },

  /**
   * Precomputed options for the signup dialog. The view must not re-evaluate
   * BoosterAccess or lockouts; submit still re-checks on the server.
   */
  async getSignupOptions(user: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const characters = await characterRepository.listByUserId(user.id);
    const resetIdentifier = resetIdentifierFor(run.scheduledStartAt);
    const eligibilityRun = {
      id: run.id,
      raidId: run.raidId,
      difficulty: run.difficulty,
      status: run.status,
      signupsOpen: run.signupsOpen,
    };

    const booster = evaluateBoosterOptions(characters, eligibilityRun, resetIdentifier);
    const lootbuddy = evaluateLootbuddyOptions(characters, eligibilityRun, resetIdentifier);
    const currentSignups = run.signups.filter(
      (signup) => signup.userId === user.id && signup.status !== "WITHDRAWN",
    );

    return {
      run: {
        id: run.id,
        title: run.title,
        raidName: run.raidName,
        difficulty: run.difficulty,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        signupWindowOpen: assertSignupWindowOpen(run),
      },
      booster,
      lootbuddy,
      currentSignups,
    };
  },

  async createBoosterSignup(
    user: AuthenticatedUser,
    input: { runId: string; characterId: string; role: CharacterRole; isBackup: boolean },
  ) {
    const { run, character, resetIdentifier } = await loadSignupContext(
      user.id,
      input.runId,
      input.characterId,
    );

    if (!assertSignupWindowOpen(run)) {
      throw new DomainError("SIGNUP_CLOSED", "Signups are not open for this run.");
    }

    const { eligible, ineligible } = evaluateBoosterOptions(
      [character],
      {
        id: run.id,
        raidId: run.raidId,
        difficulty: run.difficulty,
        status: run.status,
        signupsOpen: run.signupsOpen,
      },
      resetIdentifier,
    );

    const option = eligible.find(
      (item) => item.characterId === input.characterId && item.role === input.role,
    );
    if (!option) {
      throw boosterRejection(ineligible[0]?.reason);
    }

    const record = await persistSignup({
      runId: run.id,
      userId: user.id,
      characterId: character.id,
      participationType: "BOOSTER",
      role: input.role,
      isBackup: input.isBackup,
      status: "PENDING",
      lootbuddyMode: null,
      lootbuddyVerification: null,
    });

    await activityRepository.create({
      userId: user.id,
      type: "SIGNUP",
      message: `${user.name} signed ${character.name} as ${input.role}${input.isBackup ? " (backup)" : ""}.`,
    });

    return record;
  },

  async createLootbuddySignup(
    user: AuthenticatedUser,
    input: {
      runId: string;
      characterId: string;
      mode: LootbuddyMode;
      verification: LootbuddyVerification;
    },
  ) {
    const { run, character, resetIdentifier } = await loadSignupContext(
      user.id,
      input.runId,
      input.characterId,
    );

    if (!assertSignupWindowOpen(run)) {
      throw new DomainError("SIGNUP_CLOSED", "Signups are not open for this run.");
    }

    const { eligible, ineligible } = evaluateLootbuddyOptions(
      [character],
      {
        id: run.id,
        raidId: run.raidId,
        difficulty: run.difficulty,
        status: run.status,
        signupsOpen: run.signupsOpen,
      },
      resetIdentifier,
    );

    if (!eligible.some((item) => item.characterId === input.characterId)) {
      if (ineligible[0]?.reason === "INACTIVE") {
        throw new DomainError("CHARACTER_INACTIVE", "That character is inactive.");
      }
      throw new DomainError("LOCKOUT_CONFLICT", "That character has a conflicting lockout for this run.");
    }

    const record = await persistSignup({
      runId: run.id,
      userId: user.id,
      characterId: character.id,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: input.mode,
      lootbuddyVerification: input.verification,
    });

    await activityRepository.create({
      userId: user.id,
      type: "SIGNUP",
      message: `${user.name} signed ${character.name} as lootbuddy (${input.mode}).`,
    });

    return record;
  },

  async withdrawSignup(user: AuthenticatedUser, signupId: string) {
    const signup = await signupRepository.findById(signupId);
    if (!signup) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signup.userId !== user.id) {
      throw new DomainError("NOT_AUTHORIZED", "You can only withdraw your own signup.", 403);
    }
    if (!canSelfWithdrawSignup(signup.status, signup.run.status)) {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        signup.status === "SELECTED"
          ? "Selected signups cannot be withdrawn after the roster is published."
          : "This signup cannot be withdrawn.",
      );
    }

    assertSignupTransition(signup.status, "WITHDRAWN");
    await signupRepository.update(signup.id, { status: "WITHDRAWN" });
    await activityRepository.create({
      userId: user.id,
      type: "SIGNUP_WITHDRAWN",
      message: `${user.name} withdrew a signup for ${signup.run.title}.`,
    });
  },
};

async function loadSignupContext(userId: string, runId: string, characterId: string) {
  const run = await runRepository.findById(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }

  const character = await characterRepository.findOwnedById(userId, characterId);
  if (!character) {
    throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.");
  }

  return {
    run,
    character,
    resetIdentifier: resetIdentifierFor(run.scheduledStartAt),
  };
}

function boosterRejection(reason: string | undefined): DomainError {
  if (reason === "INACTIVE") {
    return new DomainError("CHARACTER_INACTIVE", "That character is inactive.");
  }
  if (reason === "DIFFICULTY_NOT_APPROVED") {
    return new DomainError(
      "BOOSTER_ACCESS_DIFFICULTY_MISMATCH",
      "This character is not approved for this difficulty.",
    );
  }
  if (reason === "LOCKOUT_CONFLICT") {
    return new DomainError("LOCKOUT_CONFLICT", "That character has a conflicting lockout for this run.");
  }
  return new DomainError("BOOSTER_ACCESS_REQUIRED", "Approved booster access is required for this combination.");
}

async function persistSignup(input: Parameters<typeof signupRepository.create>[0]) {
  const existing = await signupRepository.findDuplicate({
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
  });

  if (existing && isBlockingDuplicate(existing.status)) {
    throw new DomainError("DUPLICATE_SIGNUP", "This character is already signed for this run.");
  }

  try {
    if (existing?.status === "WITHDRAWN") {
      await signupRepository.update(existing.id, input);
      return { id: existing.id, revived: true };
    }
    return { ...(await signupRepository.create(input)), revived: false };
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new DomainError("DUPLICATE_SIGNUP", "This character is already signed for this run.");
    }
    throw error;
  }
}
