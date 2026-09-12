import type { BoosterQualificationMatch, CharacterRunReservationConflict } from "@/models/records";
import type {
  CharacterRole,
  RaidDifficulty,
  RunStatus,
  WowClass,
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
};

export type BoosterIneligibilityReason =
  | "INACTIVE"
  | "NO_BOOSTER_ACCESS"
  | "DIFFICULTY_NOT_APPROVED"
  | "LOCKOUT_CONFLICT"
  | "ALREADY_SELECTED_OTHER_RUN";

export type LootbuddyIneligibilityReason = "INACTIVE" | "LOCKOUT_CONFLICT";

export const BOOSTER_INELIGIBILITY_MESSAGES: Record<BoosterIneligibilityReason, string> = {
  INACTIVE: "Character is inactive.",
  NO_BOOSTER_ACCESS: "No approved booster access.",
  DIFFICULTY_NOT_APPROVED: "Not approved for this difficulty.",
  LOCKOUT_CONFLICT: "Conflicting raid lockout this reset.",
  ALREADY_SELECTED_OTHER_RUN: "Already selected for another run.",
};

export const LOOTBUDDY_INELIGIBILITY_MESSAGES: Record<LootbuddyIneligibilityReason, string> = {
  INACTIVE: "Character is inactive.",
  LOCKOUT_CONFLICT: "Conflicting raid lockout this reset.",
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

export type EligibleLootbuddyOption = {
  characterId: string;
  characterName: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
};

export type IneligibleLootbuddyCharacter = {
  characterId: string;
  characterName: string;
  realm: string;
  reason: LootbuddyIneligibilityReason;
  message: string;
};

/**
 * Booster options require an APPROVED BoosterQualification for the run difficulty.
 * A Character's specialization determines only the DEFAULT signup role — the
 * User may choose any role the Character's class can actually perform
 * (`rolesForClass`), never restricted to specialization alone. A missing or
 * unrecognized specialization does not block an otherwise-eligible Character;
 * it just means no default is offered (`defaultRole: null`) and the User must
 * choose explicitly. Heroic approval never implies Mythic.
 */
export function evaluateBoosterOptions(
  characters: EligibilityCharacter[],
  run: EligibilityRun,
  resetIdentifier: string,
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

    if (
      lockoutService.hasRunConflict(character.lockouts, {
        raidId: run.raidId,
        difficulty: run.difficulty,
        resetIdentifier,
      })
    ) {
      pushIneligible("LOCKOUT_CONFLICT");
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
    });
  }

  return { eligible, ineligible };
}

/**
 * Lootbuddy eligibility is lockout-scoped, not BoosterQualification-scoped.
 * LOOT_ONLY and PLAYING share this check in Phase 2; PLAYING does not invent
 * a booster-access requirement.
 */
export function evaluateLootbuddyOptions(
  characters: EligibilityCharacter[],
  run: EligibilityRun,
  resetIdentifier: string,
): {
  eligible: EligibleLootbuddyOption[];
  ineligible: IneligibleLootbuddyCharacter[];
} {
  const eligible: EligibleLootbuddyOption[] = [];
  const ineligible: IneligibleLootbuddyCharacter[] = [];

  for (const character of characters) {
    if (!character.isActive) {
      ineligible.push({
        characterId: character.id,
        characterName: character.name,
        realm: character.realm,
        reason: "INACTIVE",
        message: LOOTBUDDY_INELIGIBILITY_MESSAGES.INACTIVE,
      });
      continue;
    }

    if (
      lockoutService.hasRunConflict(character.lockouts, {
        raidId: run.raidId,
        difficulty: run.difficulty,
        resetIdentifier,
      })
    ) {
      ineligible.push({
        characterId: character.id,
        characterName: character.name,
        realm: character.realm,
        reason: "LOCKOUT_CONFLICT",
        message: LOOTBUDDY_INELIGIBILITY_MESSAGES.LOCKOUT_CONFLICT,
      });
      continue;
    }

    eligible.push({
      characterId: character.id,
      characterName: character.name,
      realm: character.realm,
      wowClass: character.wowClass,
      specialization: character.specialization,
    });
  }

  return { eligible, ineligible };
}

export function assertSignupWindowOpen(run: Pick<EligibilityRun, "status" | "signupsOpen">): boolean {
  return isSignupWindowOpen(run.status, run.signupsOpen);
}
