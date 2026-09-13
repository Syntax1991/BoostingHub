import type { CharacterRole, ParticipationType, RunStatus, SignupStatus } from "@/models/enums";
import { composeRoster, compositionWarnings, type RosterComposition } from "@/services/roster-composition";

export type RosterIssue = {
  code: string;
  message: string;
  signupId?: string;
};

export type RosterValidationResult = {
  canPublish: boolean;
  blockers: RosterIssue[];
  warnings: RosterIssue[];
  composition: RosterComposition;
};

export type RosterValidationMember = {
  signupId: string;
  userId: string;
  userName: string;
  characterName: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  status: SignupStatus;
  characterActive: boolean;
  boosterApproved: boolean;
};

const PUBLISHABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

/**
 * Publish blockers are hard invariants. Composition mismatch is a warning so a
 * raidlead can still ship a 5/4 healer roster after explicit acknowledgement.
 */
export function validateRosterDraft(input: {
  runStatus: RunStatus;
  selected: RosterValidationMember[];
  targets: { tanks: number; healers: number; dps: number };
}): RosterValidationResult {
  const composition = composeRoster(input.selected, input.targets);
  const blockers: RosterIssue[] = [];

  if (!PUBLISHABLE_RUN_STATUSES.includes(input.runStatus)) {
    blockers.push({
      code: "INVALID_STATE_TRANSITION",
      message: `Cannot publish a roster while the run is ${input.runStatus}.`,
    });
  }

  // A User may simultaneously hold BOOSTER participation and any number of
  // LOOTBUDDY entries on the same Run (see docs/features/signups.md) — only
  // two SELECTED BOOSTER rows for the same User is ever invalid; LOOTBUDDY
  // entries are independently selectable and never counted here.
  const seenBoosterUsers = new Map<string, string>();
  for (const item of input.selected) {
    if (item.status === "WITHDRAWN") {
      blockers.push({
        code: "SIGNUP_WITHDRAWN",
        message: `${item.characterName} is withdrawn and cannot be selected.`,
        signupId: item.signupId,
      });
    }
    if (!item.characterActive) {
      blockers.push({
        code: "CHARACTER_INACTIVE",
        message: `${item.characterName} is inactive.`,
        signupId: item.signupId,
      });
    }
    // Raid lockouts are informational only — see signup-eligibility.ts and
    // roster.service.ts's `raidSave` — never a publish blocker.
    if (item.participationType === "BOOSTER" && !item.boosterApproved) {
      blockers.push({
        code: "BOOSTER_ACCESS_INVALID",
        message: `${item.characterName} no longer has approved booster access for this role and difficulty.`,
        signupId: item.signupId,
      });
    }
    if (item.participationType === "BOOSTER") {
      const previous = seenBoosterUsers.get(item.userId);
      if (previous) {
        blockers.push({
          code: "INVALID_ROSTER_SELECTION",
          message: `${item.userName} cannot occupy more than one booster roster slot.`,
          signupId: item.signupId,
        });
      } else {
        seenBoosterUsers.set(item.userId, item.signupId);
      }
    }
  }

  return {
    canPublish: blockers.length === 0,
    blockers,
    warnings: compositionWarnings(composition),
    composition,
  };
}
