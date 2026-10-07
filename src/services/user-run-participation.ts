import type { CharacterRole, SignupStatus } from "@/models/enums";
import { isPickedSignup } from "@/services/signup-state";

/**
 * User-facing selection visibility for one signup participation.
 * Draft roster selection is operationally real — not equivalent to "Pending".
 *
 * Authority:
 * - PUBLISHED (status SELECTED) wins when present
 * - else current draft RunRosterEntry selection
 * - else active offered / declined / withdrawn signup status
 */
export type UserRunSelectionState = "NONE" | "OFFERED" | "DRAFT" | "PUBLISHED" | "NOT_SELECTED" | "WITHDRAWN";

export type UserRunParticipation = {
  selectionState: UserRunSelectionState;
  /** True when draft-selected or published-selected (same as isPickedSignup). */
  picked: boolean;
  /** Authoritative role for the current pick — draft selectedRole, else publishedRole. */
  displayRole: CharacterRole | null;
  /** Compact UI label for the Selected line / badge tone. */
  selectedLabelTone: "none" | "pending" | "draft" | "published" | "not_selected";
};

export function resolveUserRunParticipation(input: {
  status: SignupStatus;
  draftSelected: boolean;
  selectedRole: CharacterRole | null;
  publishedRole: CharacterRole | null;
}): UserRunParticipation {
  if (input.status === "WITHDRAWN") {
    return {
      selectionState: "WITHDRAWN",
      picked: false,
      displayRole: null,
      selectedLabelTone: "none",
    };
  }

  if (input.status === "SELECTED") {
    return {
      selectionState: "PUBLISHED",
      picked: true,
      displayRole: input.publishedRole ?? input.selectedRole,
      selectedLabelTone: "published",
    };
  }

  if (input.draftSelected) {
    return {
      selectionState: "DRAFT",
      picked: true,
      displayRole: input.selectedRole,
      selectedLabelTone: "draft",
    };
  }

  if (input.status === "NOT_SELECTED") {
    return {
      selectionState: "NOT_SELECTED",
      picked: false,
      displayRole: null,
      selectedLabelTone: "not_selected",
    };
  }

  // PENDING (and any other non-picked active offer)
  return {
    selectionState: "OFFERED",
    picked: false,
    displayRole: null,
    selectedLabelTone: "pending",
  };
}

/** Convenience when draft membership is known as a signup-id set. */
export function resolveUserRunParticipationFromDraftIds(
  signup: { id: string; status: SignupStatus; publishedRole: CharacterRole | null },
  draftBySignupId: ReadonlyMap<string, CharacterRole | null>,
): UserRunParticipation {
  const draftSelected = draftBySignupId.has(signup.id);
  return resolveUserRunParticipation({
    status: signup.status,
    draftSelected,
    selectedRole: draftSelected ? (draftBySignupId.get(signup.id) ?? null) : null,
    publishedRole: signup.publishedRole,
  });
}

export function isUserRunPicked(
  signup: { id: string; status: SignupStatus },
  draftSelectedSignupIds: readonly string[],
): boolean {
  return isPickedSignup(signup, draftSelectedSignupIds);
}

/** My Runs "Selected" bucket: published or draft-picked. */
export function isMyRunsSelectedBucket(participation: Pick<UserRunParticipation, "selectionState">): boolean {
  return participation.selectionState === "DRAFT" || participation.selectionState === "PUBLISHED";
}

/** My Runs "Pending" bucket: offered and not draft-picked. */
export function isMyRunsPendingBucket(
  status: SignupStatus,
  participation: Pick<UserRunParticipation, "selectionState">,
): boolean {
  return status === "PENDING" && participation.selectionState === "OFFERED";
}
