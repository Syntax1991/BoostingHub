import type { AuthenticatedUser } from "@/auth/authorization";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
  ParticipationType,
} from "@/models/enums";
import type { CharacterRunReservationConflict } from "@/models/records";
import { DomainError } from "@/lib/errors";
import { resetIdentifierFor } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import { activityRepository } from "@/repositories/activity.repository";
import type { CharacterPageRecord } from "@/repositories/character.repository";
import { characterRepository } from "@/repositories/character.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import type { IneligibleBoosterCharacter } from "@/services/signup-eligibility";
import {
  assertSignupWindowOpen,
  evaluateBoosterOptions,
  evaluateLootbuddyOptions,
} from "@/services/signup-eligibility";
import {
  assertSignupTransition,
  canSelfWithdrawSignup,
  isBlockingDuplicate,
  planCharacterOfferReconciliation,
} from "@/services/signup-state";

/**
 * Attaches cross-Run reservation info to a batch of Characters in one query
 * (never N+1 per Character). BOOSTER-only concern: LOOTBUDDY characters are
 * never checked here — see the `validateOfferedCharacters`/`evaluateLootbuddyOptions`
 * call sites, which set `reservationConflict: null` directly instead.
 */
async function withReservationConflicts<T extends { id: string }>(
  characters: T[],
  targetRunId: string,
  scheduledStartAt: string,
): Promise<Array<T & { reservationConflict: CharacterRunReservationConflict | null }>> {
  if (characters.length === 0) {
    return [];
  }
  const conflicts = await signupRepository.findReservationConflicts({
    characterIds: characters.map((character) => character.id),
    targetRunId,
    scheduledStartAt,
  });
  const byId = new Map(
    conflicts.map((row) => [
      row.characterId,
      { runId: row.runId, runTitle: row.runTitle, scheduledStartAt: row.scheduledStartAt },
    ]),
  );
  return characters.map((character) => ({ ...character, reservationConflict: byId.get(character.id) ?? null }));
}

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

  /** Own signups on one run for the participant-facing Run detail Signups section. */
  async listOwnForRun(user: AuthenticatedUser, runId: string) {
    const signups = await signupRepository.listByRunId(runId);
    return signups
      .filter((signup) => signup.userId === user.id)
      .map((signup) => ({
        id: signup.id,
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

    const rawCharacters = await characterRepository.listByUserId(user.id);
    const characters = await withReservationConflicts(rawCharacters, run.id, run.scheduledStartAt);
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

    const ownSignups = await signupRepository.listByRunAndUser(runId, user.id);
    const activeSignups = ownSignups.filter((signup) => signup.status !== "WITHDRAWN");
    const roleByCharacterId: Partial<Record<string, CharacterRole>> = {};
    for (const signup of activeSignups) {
      if (signup.character && signup.role) {
        roleByCharacterId[signup.character.id] = signup.role;
      }
    }

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
      /** The desired-set the signup dialog should preselect on open. */
      activeOffer: {
        participationType: activeSignups[0]?.participationType ?? null,
        characterIds: activeSignups
          .map((signup) => signup.character?.id)
          .filter((id): id is string => Boolean(id)),
        roleByCharacterId,
        lootbuddyMode: activeSignups[0]?.lootbuddyMode ?? null,
        lootbuddyVerification: activeSignups[0]?.lootbuddyVerification ?? null,
      },
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

    const [enrichedCharacter] = await withReservationConflicts([character], run.id, run.scheduledStartAt);
    const { eligible, ineligible } = evaluateBoosterOptions(
      [enrichedCharacter],
      {
        id: run.id,
        raidId: run.raidId,
        difficulty: run.difficulty,
        status: run.status,
        signupsOpen: run.signupsOpen,
      },
      resetIdentifier,
    );

    const option = eligible.find((item) => item.characterId === input.characterId);
    if (!option) {
      throw boosterRejection(ineligible[0]);
    }
    if (!option.roles.includes(input.role)) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        `${character.name} cannot be offered as ${CHARACTER_ROLE_LABELS[input.role]}.`,
      );
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

    // LOOTBUDDY is not subject to cross-Run reservation (see the audit note on
    // validateOfferedCharacters) — reservationConflict is always null here.
    const { eligible, ineligible } = evaluateLootbuddyOptions(
      [{ ...character, reservationConflict: null }],
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

  /**
   * The complete desired Character-offer set for one User + Run + participation
   * type. Reuses each existing RunSignup row as a Character offer (no parent
   * intent/offer model): rows no longer desired are withdrawn, WITHDRAWN rows
   * matching a re-offered Character are reactivated in place, and net-new
   * Characters get a fresh row. A User may hold only one ACTIVE participation
   * type per Run — offers of the other type are withdrawn as part of a switch.
   * Not additive: omitting a currently-offered Character removes it.
   */
  async setCharacterOffers(
    actor: AuthenticatedUser,
    input: {
      runId: string;
      participationType: ParticipationType;
      offers: Array<{ characterId: string; role?: CharacterRole }>;
      lootbuddyMode?: LootbuddyMode;
      lootbuddyVerification?: LootbuddyVerification;
    },
  ) {
    const seen = new Set<string>();
    for (const offer of input.offers) {
      if (seen.has(offer.characterId)) {
        throw new DomainError(
          "SIGNUP_OFFER_DUPLICATE_CHARACTER",
          "The same character was offered twice in one request.",
        );
      }
      seen.add(offer.characterId);
    }
    if (input.participationType === "LOOTBUDDY" && input.offers.length > 0) {
      if (!input.lootbuddyMode || !input.lootbuddyVerification) {
        throw new DomainError("VALIDATION_FAILED", "Lootbuddy mode and verification are required.");
      }
    }

    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const { plan, currentSignups } = await buildReconciliationPlan(actor.id, run, {
      participationType: input.participationType,
      desiredCharacterIds: input.offers.map((offer) => offer.characterId),
    });

    const needsWindowOpen = plan.toCreate.length > 0 || plan.toReactivate.length > 0;
    if (needsWindowOpen && !assertSignupWindowOpen(run)) {
      throw new DomainError("SIGNUP_CLOSED", "Signups are not open for this run.");
    }

    const characters = await characterRepository.listByUserId(actor.id);
    const charactersById = new Map(characters.map((character) => [character.id, character]));
    const offeredCharacters = input.offers.map((offer) => {
      const character = charactersById.get(offer.characterId);
      if (!character) {
        throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.");
      }
      return { offer, character };
    });

    const roleByCharacterId = await validateOfferedCharacters(input.participationType, offeredCharacters, run);

    const lootbuddyModeValue = input.participationType === "LOOTBUDDY" ? (input.lootbuddyMode ?? null) : null;
    const lootbuddyVerificationValue =
      input.participationType === "LOOTBUDDY" ? (input.lootbuddyVerification ?? null) : null;

    const toReactivate = plan.toReactivate.map((offer) => ({
      id: offer.id,
      characterId: offer.characterId,
      role: roleByCharacterId.get(offer.characterId) ?? null,
      lootbuddyMode: lootbuddyModeValue,
      lootbuddyVerification: lootbuddyVerificationValue,
    }));
    const toCreate = plan.toCreate.map((characterId) => ({
      characterId,
      role: roleByCharacterId.get(characterId) ?? null,
      lootbuddyMode: lootbuddyModeValue,
      lootbuddyVerification: lootbuddyVerificationValue,
    }));

    const currentById = new Map(currentSignups.map((signup) => [signup.id, signup]));
    const toUpdateRole =
      input.participationType === "BOOSTER"
        ? plan.kept
            .map((signupId) => {
              const existing = currentById.get(signupId);
              const characterId = existing?.character?.id;
              if (!existing || !characterId) return null;
              const desiredRole = roleByCharacterId.get(characterId) ?? null;
              return existing.role !== desiredRole ? { id: signupId, role: desiredRole } : null;
            })
            .filter((item): item is { id: string; role: CharacterRole | null } => item !== null)
        : [];

    const result = await signupRepository.applyOfferPlan({
      runId: input.runId,
      userId: actor.id,
      participationType: input.participationType,
      scheduledStartAt: run.scheduledStartAt,
      toWithdraw: plan.toWithdraw,
      toReactivate,
      toCreate,
      toUpdateRole,
    });

    await activityRepository.create({
      userId: actor.id,
      type: "SIGNUP",
      message: `${actor.name} updated ${input.participationType.toLowerCase()} offers for ${run.title} (${input.offers.length} offered).`,
    });

    return {
      runId: input.runId,
      participationType: input.participationType,
      created: result.created.length,
      reactivated: result.reactivated.length,
      withdrawn: result.withdrawn.length,
      kept: plan.kept.length,
    };
  },

  /**
   * Withdraws the User's entire current active offer-set for a Run (whichever
   * participation type is active) in one atomic, all-or-nothing operation —
   * the domain behind a Discord "Cancel Signup" button. A no-op signup has
   * nothing to cancel; a protected offer (roster-selected or published-locked)
   * blocks the whole cancellation instead of partially clearing the set.
   */
  async cancelActiveOffers(actor: AuthenticatedUser, input: { runId: string }) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const existingSignups = await signupRepository.listByRunAndUser(input.runId, actor.id);
    const activeType = existingSignups.find((signup) => signup.status !== "WITHDRAWN")?.participationType;
    if (!activeType) {
      throw new DomainError("NOT_FOUND", "You have no active signup on this run.", 404);
    }

    const { plan } = await buildReconciliationPlan(actor.id, run, {
      participationType: activeType,
      desiredCharacterIds: [],
    });

    const result = await signupRepository.applyOfferPlan({
      runId: input.runId,
      userId: actor.id,
      participationType: activeType,
      scheduledStartAt: run.scheduledStartAt,
      toWithdraw: plan.toWithdraw,
      toReactivate: [],
      toCreate: [],
      toUpdateRole: [],
    });

    await activityRepository.create({
      userId: actor.id,
      type: "SIGNUP_WITHDRAWN",
      message: `${actor.name} cancelled their signup for ${run.title}.`,
    });

    return { withdrawn: result.withdrawn.length };
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

function boosterRejection(ineligible: IneligibleBoosterCharacter | undefined): DomainError {
  const reason = ineligible?.reason;
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
  if (reason === "ALREADY_SELECTED_OTHER_RUN") {
    return new DomainError(
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
      ineligible?.conflictingRunTitle
        ? `${ineligible.characterName} is already selected for ${ineligible.conflictingRunTitle}.`
        : "That character is already selected for another run at the same time.",
    );
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

type LoadedRun = NonNullable<Awaited<ReturnType<typeof runRepository.findById>>>;

/**
 * Loads the User's current signup rows and the roster's draft selection, then
 * computes the desired-set reconciliation plan. A blocked removal — protected
 * by a live roster draft selection, or by the existing published+SELECTED
 * lock — fails the whole call instead of returning a partial plan.
 */
async function buildReconciliationPlan(
  userId: string,
  run: LoadedRun,
  input: { participationType: ParticipationType; desiredCharacterIds: string[] },
) {
  const currentSignups = await signupRepository.listByRunAndUser(run.id, userId);
  const roster = await rosterRepository.findByRunId(run.id);
  const rosterSelectedSignupIds = roster?.selectedSignupIds ?? [];

  const { plan, blocked } = planCharacterOfferReconciliation({
    participationType: input.participationType,
    desiredCharacterIds: input.desiredCharacterIds,
    currentSignups: currentSignups.map((signup) => ({
      id: signup.id,
      characterId: signup.character?.id ?? null,
      participationType: signup.participationType,
      status: signup.status,
    })),
    rosterSelectedSignupIds,
    runStatus: run.status,
  });

  if (blocked.length > 0) {
    if (blocked.some((item) => item.reason === "ROSTER_SELECTED")) {
      throw new DomainError(
        "SIGNUP_OFFER_ROSTER_SELECTED",
        "A currently selected offer cannot be removed. Ask the raid lead to change the roster selection first.",
      );
    }
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      "Selected signups cannot be withdrawn after the roster is published.",
    );
  }
  if (!plan) {
    throw new DomainError("VALIDATION_FAILED", "Could not compute an offer plan.");
  }

  return { plan, currentSignups };
}

/**
 * Validates every offered Character against the same eligibility rules a
 * single-Character signup already enforces (ownership already checked by the
 * caller). For BOOSTER, every offer must carry an explicit role that the
 * Character's class can actually perform (`option.roles`, from
 * `rolesForClass`) — the server never trusts an arbitrary client role, but it
 * also no longer restricts the choice to the specialization-derived default.
 * Also the Confirm-time cross-Run reservation revalidation boundary (BOOSTER
 * only — see the LOOTBUDDY audit note below): eligibility-time and Confirm-
 * time can disagree if another Run reserved the same Character in between,
 * so this re-queries fresh immediately before the caller's atomic write
 * rather than trusting the read the User's client loaded earlier.
 *
 * LOOTBUDDY audit: a LOOTBUDDY offer is just as Character-backed as a
 * BOOSTER one and could in principle double-book the same way. This is
 * deliberately NOT enforced here — the reservation rule stays scoped to
 * BOOSTER per the current requirement — so `reservationConflict` is always
 * set to null for the LOOTBUDDY branch below rather than computed. Revisit
 * if LOOTBUDDY double-booking turns out to be a real operational problem.
 *
 * Returns the resolved BOOSTER role per characterId; empty for LOOTBUDDY,
 * which carries no per-offer role.
 */
async function validateOfferedCharacters(
  participationType: ParticipationType,
  offeredCharacters: Array<{ offer: { characterId: string; role?: CharacterRole }; character: CharacterPageRecord }>,
  run: LoadedRun,
): Promise<Map<string, CharacterRole>> {
  const resetIdentifier = resetIdentifierFor(run.scheduledStartAt);
  const eligibilityRun = {
    id: run.id,
    raidId: run.raidId,
    difficulty: run.difficulty,
    status: run.status,
    signupsOpen: run.signupsOpen,
  };
  const roleByCharacterId = new Map<string, CharacterRole>();

  if (participationType === "BOOSTER") {
    const enrichedCharacters = await withReservationConflicts(
      offeredCharacters.map(({ character }) => character),
      run.id,
      run.scheduledStartAt,
    );
    const { eligible, ineligible } = evaluateBoosterOptions(enrichedCharacters, eligibilityRun, resetIdentifier);
    for (const { offer, character } of offeredCharacters) {
      const option = eligible.find((item) => item.characterId === offer.characterId);
      if (!option) {
        throw boosterRejection(ineligible.find((item) => item.characterId === offer.characterId));
      }
      if (!offer.role) {
        throw new DomainError("INVALID_CHARACTER_ROLE", `Choose a role for ${character.name}.`);
      }
      if (!option.roles.includes(offer.role)) {
        throw new DomainError(
          "INVALID_CHARACTER_ROLE",
          `${character.name} cannot be offered as ${CHARACTER_ROLE_LABELS[offer.role]}.`,
        );
      }
      roleByCharacterId.set(offer.characterId, offer.role);
    }
    return roleByCharacterId;
  }

  const lootbuddyCharacters = offeredCharacters.map(({ character }) => ({ ...character, reservationConflict: null }));
  const { eligible, ineligible } = evaluateLootbuddyOptions(lootbuddyCharacters, eligibilityRun, resetIdentifier);
  for (const { offer } of offeredCharacters) {
    if (!eligible.some((item) => item.characterId === offer.characterId)) {
      const reason = ineligible.find((item) => item.characterId === offer.characterId)?.reason;
      if (reason === "INACTIVE") {
        throw new DomainError("CHARACTER_INACTIVE", "That character is inactive.");
      }
      throw new DomainError("LOCKOUT_CONFLICT", "That character has a conflicting lockout for this run.");
    }
  }
  return roleByCharacterId;
}
