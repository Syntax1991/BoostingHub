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

/**
 * A current, counted Character offer — PENDING or SELECTED. WITHDRAWN and
 * NOT_SELECTED are historical outcomes: still persisted for audit, but never
 * an active offer for signup lists, "also offered" alternates, or signup
 * counts. Roster re-selection is a separate concern (a NOT_SELECTED row from
 * an earlier publish remains a legitimate re-roster candidate) and does not
 * use this predicate.
 */
export function isActiveSignupOffer(status: SignupStatus): boolean {
  return status === "PENDING" || status === "SELECTED";
}

export type OfferReconciliationSignup = {
  id: string;
  characterId: string | null;
  participationType: ParticipationType;
  status: SignupStatus;
};

export type OfferReconciliationPlan = {
  /** Signup ids transitioning to WITHDRAWN: same-type offers no longer desired. */
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
 * Pure desired-set reconciliation for BOOSTER Character offers only. A User
 * may simultaneously hold Booster participation AND any number of Lootbuddy
 * entries on the same Run (see `planLootbuddyReconciliation`) — this function
 * never touches the other participation type's rows, only same-type (BOOSTER)
 * offers. A row currently selected on the roster draft, or a published+
 * SELECTED row the lifecycle already protects, blocks the whole plan rather
 * than being silently skipped — the caller returns `blocked` instead of a
 * plan so the mutation is all-or-nothing.
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
  const sameTypeWithdrawn = input.currentSignups.filter(
    (row) => row.status === "WITHDRAWN" && row.participationType === input.participationType,
  );

  const removalCandidates = sameTypeActive.filter((row) => !row.characterId || !desired.has(row.characterId));

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

export type LootbuddyReconciliationSignup = {
  id: string;
  status: SignupStatus;
};

export type DesiredLootbuddyEntry = {
  /** Present = edit an existing owned row; absent = always a brand-new row (never a revival of old history — see `planLootbuddyReconciliation`). */
  signupId?: string;
};

export type LootbuddyReconciliationPlan = {
  /** Existing active LOOTBUDDY rows omitted from the desired set. */
  toWithdraw: string[];
  /** Desired entries with no `signupId` — always new rows, never a reactivated historical one (identity is RunSignup.id, not a natural key). */
  toCreateCount: number;
  /** Desired entries whose `signupId` matches an existing active row — updated in place, never withdrawn+recreated. */
  toUpdate: string[];
};

/**
 * Pure desired-set reconciliation for LOOTBUDDY entries, keyed by
 * `RunSignup.id` rather than `characterId` — two entries with the same Class
 * and Mode are still two distinct rows if the User intentionally has two.
 * Never touches BOOSTER rows. A `signupId` naming a row not present in
 * `currentSignups` (already withdrawn, foreign, or fabricated) is a caller
 * error the Service must reject before this ever runs — this function only
 * ever sees the acting User's own current LOOTBUDDY rows.
 */
export function planLootbuddyReconciliation(input: {
  desiredEntries: readonly DesiredLootbuddyEntry[];
  currentSignups: readonly LootbuddyReconciliationSignup[];
  rosterSelectedSignupIds: readonly string[];
  runStatus: RunStatus;
}): { plan: LootbuddyReconciliationPlan | null; blocked: OfferRemovalBlock[] } {
  const activeRows = input.currentSignups.filter((row) => row.status !== "WITHDRAWN");
  const desiredSignupIds = new Set(
    input.desiredEntries.map((entry) => entry.signupId).filter((id): id is string => Boolean(id)),
  );

  const removalCandidates = activeRows.filter((row) => !desiredSignupIds.has(row.id));

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

  const toUpdate = input.desiredEntries
    .map((entry) => entry.signupId)
    .filter((id): id is string => Boolean(id) && activeRows.some((row) => row.id === id));
  const toCreateCount = input.desiredEntries.filter((entry) => !entry.signupId).length;

  return {
    plan: {
      toWithdraw: removalCandidates.map((row) => row.id),
      toCreateCount,
      toUpdate,
    },
    blocked: [],
  };
}
