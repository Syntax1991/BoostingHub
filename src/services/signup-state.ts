import type { ParticipationType, RunStatus, SignupStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * Signup lifecycle is independent of run lifecycle.
 * Withdrawing a signup does not cancel the run.
 */
export const SIGNUP_TRANSITIONS: Record<SignupStatus, readonly SignupStatus[]> = {
  PENDING: ["SELECTED", "NOT_SELECTED", "WITHDRAWN"],
  SELECTED: ["NOT_SELECTED", "WITHDRAWN"],
  NOT_SELECTED: ["SELECTED", "WITHDRAWN"],
  WITHDRAWN: [],
};

/** Once a roster is published, SELECTED players cannot self-withdraw. */
const ROSTER_LOCKED_RUN_STATUSES: readonly RunStatus[] = ["PUBLISHED", "IN_PROGRESS", "COMPLETED"];

export function canTransitionSignup(from: SignupStatus, to: SignupStatus): boolean {
  return SIGNUP_TRANSITIONS[from].includes(to);
}

export function assertSignupTransition(from: SignupStatus, to: SignupStatus): void {
  if (!canTransitionSignup(from, to)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Signup status cannot move from ${from} to ${to}.`,
    );
  }
}

/**
 * Self-withdrawal is a player action, not a raid-lead override.
 * SELECTED + published-or-later is locked so a published roster stays stable.
 */
export function canSelfWithdrawSignup(signupStatus: SignupStatus, runStatus: RunStatus): boolean {
  if (signupStatus === "WITHDRAWN" || signupStatus === "NOT_SELECTED") {
    return false;
  }
  if (runStatus === "COMPLETED" || runStatus === "CANCELLED") {
    return false;
  }
  if (signupStatus === "SELECTED" && ROSTER_LOCKED_RUN_STATUSES.includes(runStatus)) {
    return false;
  }
  return signupStatus === "PENDING" || signupStatus === "SELECTED";
}

/** Withdrawn rows stay persisted; they do not block a later revive of the same combination. */
export function isBlockingDuplicate(status: SignupStatus): boolean {
  return status !== "WITHDRAWN";
}

export type OfferReconciliationSignup = {
  id: string;
  characterId: string | null;
  participationType: ParticipationType;
  status: SignupStatus;
};

export type OfferReconciliationPlan = {
  /** Signup ids transitioning to WITHDRAWN: same-type offers no longer desired, plus every
   *  active offer of the other participation type (a User may hold only one active type). */
  toWithdraw: string[];
  /** WITHDRAWN rows reused instead of inserting a duplicate row for the same unique key. */
  toReactivate: Array<{ id: string; characterId: string }>;
  /** Desired Characters with no existing row (active or withdrawn) of this type on this run. */
  toCreate: string[];
  /** Already-active same-type offers that remain in the desired set, untouched. */
  kept: string[];
};

export type OfferRemovalBlock = {
  signupId: string;
  reason: "ROSTER_SELECTED" | "PUBLISHED_LOCKED";
};

/**
 * Pure desired-set reconciliation. A User may hold only one ACTIVE participation
 * type (BOOSTER or LOOTBUDDY) per Run: offers of the other type are always
 * removal candidates alongside same-type offers the desired set no longer lists.
 * A row currently selected on the roster draft, or a published+SELECTED row the
 * lifecycle already protects, blocks the whole plan rather than being silently
 * skipped — the caller returns `blocked` instead of a plan so the mutation is
 * all-or-nothing.
 */
export function planCharacterOfferReconciliation(input: {
  participationType: ParticipationType;
  desiredCharacterIds: readonly string[];
  currentSignups: readonly OfferReconciliationSignup[];
  rosterSelectedSignupIds: readonly string[];
  runStatus: RunStatus;
}): { plan: OfferReconciliationPlan | null; blocked: OfferRemovalBlock[] } {
  const desired = new Set(input.desiredCharacterIds);
  const activeRows = input.currentSignups.filter((row) => row.status !== "WITHDRAWN");
  const sameTypeActive = activeRows.filter((row) => row.participationType === input.participationType);
  const otherTypeActive = activeRows.filter((row) => row.participationType !== input.participationType);
  const sameTypeWithdrawn = input.currentSignups.filter(
    (row) => row.status === "WITHDRAWN" && row.participationType === input.participationType,
  );

  const removalCandidates = [
    ...sameTypeActive.filter((row) => !row.characterId || !desired.has(row.characterId)),
    ...otherTypeActive,
  ];

  const blocked: OfferRemovalBlock[] = [];
  for (const row of removalCandidates) {
    if (input.rosterSelectedSignupIds.includes(row.id)) {
      blocked.push({ signupId: row.id, reason: "ROSTER_SELECTED" });
      continue;
    }
    if (!canSelfWithdrawSignup(row.status, input.runStatus)) {
      blocked.push({ signupId: row.id, reason: "PUBLISHED_LOCKED" });
    }
  }

  if (blocked.length > 0) {
    return { plan: null, blocked };
  }

  const keptRows = sameTypeActive.filter((row) => row.characterId && desired.has(row.characterId));
  const keptCharacterIds = new Set(keptRows.map((row) => row.characterId as string));

  const toReactivate: Array<{ id: string; characterId: string }> = [];
  const toCreate: string[] = [];
  for (const characterId of desired) {
    if (keptCharacterIds.has(characterId)) continue;
    const withdrawnRow = sameTypeWithdrawn.find((row) => row.characterId === characterId);
    if (withdrawnRow) {
      toReactivate.push({ id: withdrawnRow.id, characterId });
    } else {
      toCreate.push(characterId);
    }
  }

  return {
    plan: {
      toWithdraw: removalCandidates.map((row) => row.id),
      toReactivate,
      toCreate,
      kept: keptRows.map((row) => row.id),
    },
    blocked: [],
  };
}
