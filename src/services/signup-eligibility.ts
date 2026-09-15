import type { BoosterQualificationMatch, CharacterRunReservationConflict, SignupRaidSaveInfo } from "@/models/records";
import type {
  CharacterRole,
  RaidDifficulty,
  RunLootType,
  RunStatus,
  WowClass,
  WowRegion,
} from "@/models/enums";
import { roleForSpecialization, rolesForClass } from "@/lib/wow-specializations";
import { projectRunContentLockouts, type RunContentRaidSaveInfo } from "@/lib/run-content-lockouts";
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
  /** @deprecated Prefer `contents` — transitional singular mirror only. */
  raidId: string;
  difficulty: RaidDifficulty;
  status: RunStatus;
  signupsOpen: boolean;
  /** @deprecated Prefer per-content totals on `contents`. */
  totalBossCount: number;
  /** Used with each Character's region to resolve the regional WoW reset containing this instant. */
  scheduledStartAt: string;
  lootType: RunLootType;
  /** Authoritative ordered raid contents for lockout projection. */
  contents: Array<{
    raidId: string;
    raidName: string;
    sortOrder: number;
    plannedBossCount: number;
    totalBossCount: number;
  }>;
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
   * @deprecated Prefer `contentSaves` — singular mirror of the primary content only.
   */
  raidSave: SignupRaidSaveInfo | null;
  /** Informational per-content lockouts for this Run — never eligibility blockers. */
  contentSaves: RunContentRaidSaveInfo[];
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
 * Verified lockouts for every RunRaidContent on the target Run.
 * Informational only — never eligibility blockers.
 */
function findContentSaves(
  character: Pick<EligibilityCharacter, "lockouts" | "region">,
  run: EligibilityRun,
): RunContentRaidSaveInfo[] {
  const contents =
    run.contents.length > 0
      ? run.contents
      : [
          {
            raidId: run.raidId,
            raidName: "Raid",
            sortOrder: 1,
            plannedBossCount: run.totalBossCount,
            totalBossCount: run.totalBossCount,
          },
        ];
  const resetIdentifier = lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt);
  return projectRunContentLockouts({
    contents,
    difficulty: run.difficulty,
    lootType: run.lootType,
    findSave: (content) => {
      const lockout = lockoutService.findExactLockout(character.lockouts, {
        raidId: content.raidId,
        difficulty: run.difficulty,
        resetIdentifier,
      });
      return lockout ? lockoutService.toRaidSaveInfo(lockout, content.totalBossCount) : null;
    },
  });
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

    const contentSaves = findContentSaves(character, run);
    eligible.push({
      characterId: character.id,
      characterName: character.name,
      realm: character.realm,
      wowClass: character.wowClass,
      specialization: character.specialization,
      roles: rolesForClass(character.wowClass),
      defaultRole,
      raidSave: contentSaves[0]?.raidSave ?? null,
      contentSaves,
    });
  }

  return { eligible, ineligible };
}

export function assertSignupWindowOpen(run: Pick<EligibilityRun, "status" | "signupsOpen">): boolean {
  return isSignupWindowOpen(run.status, run.signupsOpen);
}
