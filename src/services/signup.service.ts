import type { AuthenticatedUser } from "@/auth/authorization";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
  WowClass,
} from "@/models/enums";
import type { CharacterRunReservationConflict } from "@/models/records";
import { DomainError } from "@/lib/errors";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import { activityRepository } from "@/repositories/activity.repository";
import type { CharacterPageRecord } from "@/repositories/character.repository";
import { characterRepository } from "@/repositories/character.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import type { IneligibleBoosterCharacter } from "@/services/signup-eligibility";
import { assertSignupWindowOpen, evaluateBoosterOptions } from "@/services/signup-eligibility";
import {
  assertSignupTransition,
  canSelfWithdrawSignup,
  isBlockingDuplicate,
  planCharacterOfferReconciliation,
  planLootbuddyReconciliation,
} from "@/services/signup-state";

/**
 * Attaches cross-Run reservation info to a batch of Characters in one query
 * (never N+1 per Character). BOOSTER-only concern: characterless LOOTBUDDY
 * entries never enter this path; Character-backed legacy Lootbuddy rows are
 * also not reservation-checked (see roster draft selection).
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
      /** Legacy Character-backed Lootbuddy rows have no lootbuddyClass — display falls back to the Character's class. */
      lootbuddyClass: signup.lootbuddyClass ?? signup.character?.wowClass ?? null,
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
        lootbuddyClass: signup.lootbuddyClass ?? signup.character?.wowClass ?? null,
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
    const eligibilityRun = {
      id: run.id,
      raidId: run.raidId,
      difficulty: run.difficulty,
      status: run.status,
      signupsOpen: run.signupsOpen,
      totalBossCount: run.totalBossCount,
      scheduledStartAt: run.scheduledStartAt,
    };

    const booster = evaluateBoosterOptions(characters, eligibilityRun);

    const ownSignups = await signupRepository.listByRunAndUser(runId, user.id);
    const activeSignups = ownSignups.filter((signup) => signup.status !== "WITHDRAWN");
    const activeBoosterSignups = activeSignups.filter((signup) => signup.participationType === "BOOSTER");
    const activeLootbuddySignups = activeSignups.filter((signup) => signup.participationType === "LOOTBUDDY");

    const roleByCharacterId: Partial<Record<string, CharacterRole>> = {};
    for (const signup of activeBoosterSignups) {
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
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        signupWindowOpen: assertSignupWindowOpen(run),
        totalBossCount: run.totalBossCount,
      },
      booster,
      /** The desired-set the Booster half of the signup dialog should preselect on open. Independent of Lootbuddy — a User may hold both at once. */
      activeBoosterOffers: {
        characterIds: activeBoosterSignups
          .map((signup) => signup.character?.id)
          .filter((id): id is string => Boolean(id)),
        roleByCharacterId,
      },
      /** Every currently active Lootbuddy entry, identified by RunSignup.id — never collapsed into one intent. */
      activeLootbuddies: activeLootbuddySignups.map((signup) => ({
        signupId: signup.id,
        wowClass: signup.lootbuddyClass ?? signup.character?.wowClass ?? null,
        mode: signup.lootbuddyMode ?? "LOOT_ONLY",
        verification: signup.lootbuddyVerification ?? "NONE",
      })),
    };
  },

  async createBoosterSignup(
    user: AuthenticatedUser,
    input: { runId: string; characterId: string; role: CharacterRole; isBackup: boolean },
  ) {
    const { run, character } = await loadSignupContext(
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
        totalBossCount: run.totalBossCount,
        scheduledStartAt: run.scheduledStartAt,
      },
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
      lootbuddyClass: null,
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

  /**
   * The complete desired BOOSTER Character-offer set for one User + Run.
   * Reuses each existing RunSignup row as a Character offer (no parent
   * intent/offer model): rows no longer desired are withdrawn, WITHDRAWN rows
   * matching a re-offered Character are reactivated in place, and net-new
   * Characters get a fresh row. Not additive: omitting a currently-offered
   * Character removes it. BOOSTER-only — never touches the User's Lootbuddy
   * entries on this Run (see `setLootbuddies`); a User may hold Booster
   * participation and any number of Lootbuddy entries on the same Run at once.
   */
  async setCharacterOffers(
    actor: AuthenticatedUser,
    input: { runId: string; offers: Array<{ characterId: string; role?: CharacterRole }> },
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

    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const { plan, currentSignups } = await buildReconciliationPlan(actor.id, run, {
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

    const roleByCharacterId = await validateOfferedCharacters(offeredCharacters, run);

    const toReactivate = plan.toReactivate.map((offer) => ({
      id: offer.id,
      characterId: offer.characterId,
      role: roleByCharacterId.get(offer.characterId) ?? null,
    }));
    const toCreate = plan.toCreate.map((characterId) => ({
      characterId,
      role: roleByCharacterId.get(characterId) ?? null,
    }));

    const currentById = new Map(currentSignups.map((signup) => [signup.id, signup]));
    const toUpdateRole = plan.kept
      .map((signupId) => {
        const existing = currentById.get(signupId);
        const characterId = existing?.character?.id;
        if (!existing || !characterId) return null;
        const desiredRole = roleByCharacterId.get(characterId) ?? null;
        return existing.role !== desiredRole ? { id: signupId, role: desiredRole } : null;
      })
      .filter((item): item is { id: string; role: CharacterRole | null } => item !== null);

    const result = await signupRepository.applyOfferPlan({
      runId: input.runId,
      userId: actor.id,
      scheduledStartAt: run.scheduledStartAt,
      toWithdraw: plan.toWithdraw,
      toReactivate,
      toCreate,
      toUpdateRole,
    });

    await activityRepository.create({
      userId: actor.id,
      type: "SIGNUP",
      message: `${actor.name} updated booster offers for ${run.title} (${input.offers.length} offered).`,
    });

    return {
      runId: input.runId,
      created: result.created.length,
      reactivated: result.reactivated.length,
      withdrawn: result.withdrawn.length,
      kept: plan.kept.length,
    };
  },

  /**
   * The complete desired LOOTBUDDY entry set for one User + Run — a distinct
   * collection from Booster offers, never a discriminator on the same one
   * (see docs/features/signups.md). Each entry is characterless: identity is
   * `RunSignup.id`, never Class+Mode, so two entries with the same Class and
   * Mode are still two distinct rows when the User intentionally adds two. An
   * entry with `signupId` edits that existing owned row in place; an entry
   * without one always creates a brand-new row — a bare desired entry never
   * revives old withdrawn history the way Booster's characterId-keyed offers
   * do, because there is no natural key to revive by. Omitting an existing
   * entry withdraws it. Never touches BOOSTER rows.
   */
  async setLootbuddies(
    actor: AuthenticatedUser,
    input: {
      runId: string;
      lootbuddies: Array<{
        signupId?: string;
        wowClass: WowClass;
        mode: LootbuddyMode;
        verification?: LootbuddyVerification;
      }>;
    },
  ) {
    const seenSignupIds = new Set<string>();
    for (const entry of input.lootbuddies) {
      if (!entry.signupId) continue;
      if (seenSignupIds.has(entry.signupId)) {
        throw new DomainError(
          "SIGNUP_OFFER_DUPLICATE_CHARACTER",
          "The same lootbuddy entry was referenced twice in one request.",
        );
      }
      seenSignupIds.add(entry.signupId);
    }

    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const currentSignups = await signupRepository.listByRunAndUser(input.runId, actor.id);
    const currentLootbuddies = currentSignups.filter((signup) => signup.participationType === "LOOTBUDDY");
    const currentById = new Map(currentLootbuddies.map((signup) => [signup.id, signup]));

    // A client may only ever reference its own current LOOTBUDDY rows on this Run — never another User's signupId, and never a foreign/withdrawn one.
    for (const entry of input.lootbuddies) {
      if (entry.signupId && !currentById.has(entry.signupId)) {
        throw new DomainError("NOT_FOUND", "A referenced lootbuddy entry was not found.", 404);
      }
    }

    const roster = await rosterRepository.findByRunId(input.runId);
    const rosterSelectedSignupIds = roster?.selectedSignupIds ?? [];

    const { plan, blocked } = planLootbuddyReconciliation({
      desiredEntries: input.lootbuddies.map((entry) => ({ signupId: entry.signupId })),
      currentSignups: currentLootbuddies.map((signup) => ({ id: signup.id, status: signup.status })),
      rosterSelectedSignupIds,
      runStatus: run.status,
    });

    if (blocked.length > 0) {
      if (blocked.some((item) => item.reason === "ROSTER_SELECTED")) {
        throw new DomainError(
          "SIGNUP_OFFER_ROSTER_SELECTED",
          "A currently selected lootbuddy entry cannot be removed. Ask the raid lead to change the roster selection first.",
        );
      }
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Selected signups cannot be withdrawn after the roster is published.",
      );
    }
    if (!plan) {
      throw new DomainError("VALIDATION_FAILED", "Could not compute a lootbuddy plan.");
    }

    if (plan.toCreateCount > 0 && !assertSignupWindowOpen(run)) {
      throw new DomainError("SIGNUP_CLOSED", "Signups are not open for this run.");
    }

    const bySignupId = new Map(
      input.lootbuddies.filter((entry): entry is typeof entry & { signupId: string } => Boolean(entry.signupId)).map((entry) => [entry.signupId, entry]),
    );
    const toUpdate = plan.toUpdate
      .map((signupId) => {
        const entry = bySignupId.get(signupId);
        const existing = currentById.get(signupId);
        if (!entry || !existing) return null;
        const desiredVerification = entry.verification ?? "NONE";
        const changed =
          existing.lootbuddyClass !== entry.wowClass ||
          existing.lootbuddyMode !== entry.mode ||
          existing.lootbuddyVerification !== desiredVerification;
        if (!changed) return null;
        return {
          id: signupId,
          lootbuddyClass: entry.wowClass,
          lootbuddyMode: entry.mode,
          lootbuddyVerification: desiredVerification,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const toCreate = input.lootbuddies
      .filter((entry) => !entry.signupId)
      .map((entry) => ({
        lootbuddyClass: entry.wowClass,
        lootbuddyMode: entry.mode,
        lootbuddyVerification: entry.verification ?? "NONE",
      }));

    const result = await signupRepository.applyLootbuddyPlan({
      runId: input.runId,
      userId: actor.id,
      toWithdraw: plan.toWithdraw,
      toUpdate,
      toCreate,
    });

    await activityRepository.create({
      userId: actor.id,
      type: "SIGNUP",
      message: `${actor.name} updated lootbuddy entries for ${run.title} (${input.lootbuddies.length} total).`,
    });

    return {
      runId: input.runId,
      created: result.created.length,
      updated: result.updated.length,
      withdrawn: result.withdrawn.length,
    };
  },

  /**
   * Withdraws the User's entire active BOOSTER offer-set for a Run in one
   * atomic, all-or-nothing operation — "Cancel Booster Signup." Never touches
   * the User's Lootbuddy entries on this Run (removing a Lootbuddy is its own
   * action via `setLootbuddies`) — the two participation types cancel
   * independently, matching that they coexist. A no-op signup has nothing to
   * cancel; a protected offer (roster-selected or published-locked) blocks
   * the whole cancellation instead of partially clearing the set.
   */
  async cancelBoosterSignup(actor: AuthenticatedUser, input: { runId: string }) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }

    const existingSignups = await signupRepository.listByRunAndUser(input.runId, actor.id);
    const hasActiveBooster = existingSignups.some(
      (signup) => signup.status !== "WITHDRAWN" && signup.participationType === "BOOSTER",
    );
    if (!hasActiveBooster) {
      throw new DomainError("NOT_FOUND", "You have no active booster signup on this run.", 404);
    }

    const { plan } = await buildReconciliationPlan(actor.id, run, { desiredCharacterIds: [] });

    const result = await signupRepository.applyOfferPlan({
      runId: input.runId,
      userId: actor.id,
      scheduledStartAt: run.scheduledStartAt,
      toWithdraw: plan.toWithdraw,
      toReactivate: [],
      toCreate: [],
      toUpdateRole: [],
    });

    await activityRepository.create({
      userId: actor.id,
      type: "SIGNUP_WITHDRAWN",
      message: `${actor.name} cancelled their booster signup for ${run.title}.`,
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
  input: { desiredCharacterIds: string[] },
) {
  const currentSignups = await signupRepository.listByRunAndUser(run.id, userId);
  const roster = await rosterRepository.findByRunId(run.id);
  const rosterSelectedSignupIds = roster?.selectedSignupIds ?? [];

  const { plan, blocked } = planCharacterOfferReconciliation({
    participationType: "BOOSTER",
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
 * Validates every offered BOOSTER Character against the same eligibility
 * rules a single-Character signup already enforces (ownership already
 * checked by the caller). Every offer must carry an explicit role that the
 * Character's class can actually perform (`option.roles`, from
 * `rolesForClass`) — the server never trusts an arbitrary client role, but it
 * also no longer restricts the choice to the specialization-derived default.
 * Also the Confirm-time cross-Run reservation revalidation boundary:
 * eligibility-time and Confirm-time can disagree if another Run reserved the
 * same Character in between, so this re-queries fresh immediately before the
 * caller's atomic write rather than trusting the read the User's client
 * loaded earlier. Returns the resolved role per characterId.
 */
async function validateOfferedCharacters(
  offeredCharacters: Array<{ offer: { characterId: string; role?: CharacterRole }; character: CharacterPageRecord }>,
  run: LoadedRun,
): Promise<Map<string, CharacterRole>> {
  const eligibilityRun = {
    id: run.id,
    raidId: run.raidId,
    difficulty: run.difficulty,
    status: run.status,
    signupsOpen: run.signupsOpen,
    totalBossCount: run.totalBossCount,
    scheduledStartAt: run.scheduledStartAt,
  };
  const roleByCharacterId = new Map<string, CharacterRole>();

  const enrichedCharacters = await withReservationConflicts(
    offeredCharacters.map(({ character }) => character),
    run.id,
    run.scheduledStartAt,
  );
  const { eligible, ineligible } = evaluateBoosterOptions(enrichedCharacters, eligibilityRun);
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
