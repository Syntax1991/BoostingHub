import type { BoosterQualificationMatch, CharacterRunReservationConflict, SignupRaidSaveInfo } from "@/models/records";
import type {
  CharacterRole,
  RaidDifficulty,
  RunStatus,
  WowClass,
  WowRegion,
} from "@/models/enums";
import { roleForSpecialization, rolesForClass } from "@/lib/wow-specializations";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { lockoutService } from "@/services/lockout.service";
import { isSignupWindowOpen } from "@/services/run-state";

export type EligibilityLockout = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  isComplete: boolean;
  bossesDefeated: number;
};

export type EligibilityCharacter = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string | null;
  isActive: boolean;
  boosterQualifications: BoosterQualificationMatch[];
  lockouts: EligibilityLockout[];
  /**
   * Non-null when this Character is already reserved — draft-selected into
   * another Run's roster, or SELECTED there — on a different Run scheduled
   * at the exact same time. Populated by the caller before evaluation (a
   * cross-Run scheduling rule, never derived from lockouts).
   */
  reservationConflict: CharacterRunReservationConflict | null;
};

export type EligibilityRun = {
  id: string;
  raidId: string;
  difficulty: RaidDifficulty;
  status: RunStatus;
  signupsOpen: boolean;
  /** The target Run's raid's total boss count — needed only to render raid-save progress (e.g. "8/8"), never for eligibility. */
  totalBossCount: number;
  /** Used with each Character's region to resolve the regional WoW reset containing this instant. */
  scheduledStartAt: string;
};

export type BoosterIneligibilityReason =
  | "INACTIVE"
  | "NO_BOOSTER_ACCESS"
  | "DIFFICULTY_NOT_APPROVED"
  | "ALREADY_SELECTED_OTHER_RUN";

export const BOOSTER_INELIGIBILITY_MESSAGES: Record<BoosterIneligibilityReason, string> = {
  INACTIVE: "Character is inactive.",
  NO_BOOSTER_ACCESS: "No approved booster access.",
  DIFFICULTY_NOT_APPROVED: "Not approved for this difficulty.",
  ALREADY_SELECTED_OTHER_RUN: "Already selected for another run.",
};

export type EligibleBoosterOption = {
  characterId: string;
  characterName: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
  /** Every role this Character's class can actually perform — the signup role choice is bounded to this set. */
  roles: CharacterRole[];
  /** Specialization-derived default for a new selection, or null when specialization is missing/unrecognized — never a guess. */
  defaultRole: CharacterRole | null;
  /**
   * Informational verified lockout for the target Run's exact raid/difficulty
   * and this Character's regional reset containing `scheduledStartAt`.
   * Includes verified 0/x. Null means unknown/unverified — never affects eligibility.
   */
  raidSave: SignupRaidSaveInfo | null;
};

export type IneligibleBoosterCharacter = {
  characterId: string;
  characterName: string;
  realm: string;
  reason: BoosterIneligibilityReason;
  message: string;
  /** Present only when reason is ALREADY_SELECTED_OTHER_RUN. */
  conflictingRunId?: string;
  conflictingRunTitle?: string;
  conflictingScheduledStartAt?: string;
};

/**
 * Verified lockout for the target Run's own raid/difficulty and the Character's
 * regional reset containing the Run schedule — including verified 0/x.
 * A different raid, difficulty, or reset is never surfaced. Informational only.
 */
function findRaidSave(
  character: Pick<EligibilityCharacter, "lockouts" | "region">,
  run: EligibilityRun,
): SignupRaidSaveInfo | null {
  const resetIdentifier = lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt);
  const lockout = lockoutService.findExactLockout(character.lockouts, {
    raidId: run.raidId,
    difficulty: run.difficulty,
    resetIdentifier,
  });
  return lockout ? lockoutService.toRaidSaveInfo(lockout, run.totalBossCount) : null;
}

/**
 * Booster options require an APPROVED BoosterQualification for the run difficulty.
 * A Character's specialization determines only the DEFAULT signup role — the
 * User may choose any role the Character's class can actually perform
 * (`rolesForClass`), never restricted to specialization alone. A missing or
 * unrecognized specialization does not block an otherwise-eligible Character;
 * it just means no default is offered (`defaultRole: null`) and the User must
 * choose explicitly. Heroic approval never implies Mythic. Raid save/lockout
 * status is informational only (`raidSave`) — a saved Character remains fully
 * eligible; the Raid Lead decides operationally whether to use it.
 */
export function evaluateBoosterOptions(
  characters: EligibilityCharacter[],
  run: EligibilityRun,
): {
  eligible: EligibleBoosterOption[];
  ineligible: IneligibleBoosterCharacter[];
} {
  const eligible: EligibleBoosterOption[] = [];
  const ineligible: IneligibleBoosterCharacter[] = [];

  for (const character of characters) {
    const pushIneligible = (
      reason: BoosterIneligibilityReason,
      extra?: Pick<IneligibleBoosterCharacter, "conflictingRunId" | "conflictingRunTitle" | "conflictingScheduledStartAt">,
    ) => {
      ineligible.push({
        characterId: character.id,
        characterName: character.name,
        realm: character.realm,
        reason,
        message:
          reason === "ALREADY_SELECTED_OTHER_RUN" && extra?.conflictingRunTitle
            ? `Already selected for ${extra.conflictingRunTitle}.`
            : BOOSTER_INELIGIBILITY_MESSAGES[reason],
        ...extra,
      });
    };

    if (!character.isActive) {
      pushIneligible("INACTIVE");
      continue;
    }

    // Cross-Run scheduling conflict — independent of booster access, lockouts,
    // and role choice (the same Character cannot be reserved on two colliding
    // Runs regardless of which role it would play).
    if (character.reservationConflict) {
      pushIneligible("ALREADY_SELECTED_OTHER_RUN", {
        conflictingRunId: character.reservationConflict.runId,
        conflictingRunTitle: character.reservationConflict.runTitle,
        conflictingScheduledStartAt: character.reservationConflict.scheduledStartAt,
      });
      continue;
    }

    const approvedForRun = boosterQualificationService.isApprovedFor(
      character.boosterQualifications,
      run.difficulty,
    );

    if (!approvedForRun) {
      const approvedOtherDifficulty = character.boosterQualifications.some(
        (record) => record.status === "APPROVED" && record.difficulty !== run.difficulty,
      );
      pushIneligible(approvedOtherDifficulty ? "DIFFICULTY_NOT_APPROVED" : "NO_BOOSTER_ACCESS");
      continue;
    }

    const defaultRole = character.specialization
      ? roleForSpecialization(character.wowClass, character.specialization)
      : null;

    eligible.push({
      characterId: character.id,
      characterName: character.name,
      realm: character.realm,
      wowClass: character.wowClass,
      specialization: character.specialization,
      roles: rolesForClass(character.wowClass),
      defaultRole,
      raidSave: findRaidSave(character, run),
    });
  }

  return { eligible, ineligible };
}

export function assertSignupWindowOpen(run: Pick<EligibilityRun, "status" | "signupsOpen">): boolean {
  return isSignupWindowOpen(run.status, run.signupsOpen);
}
