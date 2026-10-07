import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { isDpsRole } from "@/lib/character-roles";
import {
  projectRunStaffingFromRun,
  type RunStaffingProjection,
  type RunStaffingShortage,
} from "@/lib/run-staffing";
import type { CharacterRole, WowClass } from "@/models/enums";
import { characterRepository } from "@/repositories/character.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import {
  evaluateBoosterOptions,
  type EligibleBoosterOption,
  type IneligibleBoosterCharacter,
} from "@/services/signup-eligibility";
import { withSignupEligibilityContext } from "@/services/signup-eligibility-context";

export type RosterAssistantBoosterCandidate = {
  characterId: string;
  characterName: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
  concreteRole: CharacterRole;
  /** Concrete roles this Character can fill for the shortage bucket. */
  roles: CharacterRole[];
  itemLevel: number | null;
  ownerUserId: string;
  ownerName: string;
  /** Informational lockout attention across Run contents — never an eligibility gate. */
  lockoutAttention: boolean;
};

export type RosterAssistantLootbuddyCandidate = {
  signupId: string;
  userId: string;
  userName: string;
  lootbuddyClass: WowClass | null;
};

export type RosterAssistantResult = {
  run: {
    id: string;
    title: string;
    productLabel: string;
    contentSummary: string;
    difficulty: RunListRecord["difficulty"];
    lootType: RunListRecord["lootType"];
    scheduledStartAt: string;
    status: RunListRecord["status"];
  };
  staffing: RunStaffingProjection;
  shortages: RunStaffingShortage;
  fullyStaffed: boolean;
  candidates: {
    tanks: RosterAssistantBoosterCandidate[];
    healers: RosterAssistantBoosterCandidate[];
    dps: RosterAssistantBoosterCandidate[];
    lootbuddies: RosterAssistantLootbuddyCandidate[];
  };
  /** Diagnostic exclusions from the booster pool (not recommended). */
  excluded: IneligibleBoosterCharacter[];
};

function toEligibilityRun(run: RunListRecord) {
  return {
    id: run.id,
    difficulty: run.difficulty,
    status: run.status,
    signupsOpen: run.signupsOpen,
    scheduledStartAt: run.scheduledStartAt,
    lootType: run.lootType,
    contents: run.contents.map((content) => ({
      raidId: content.raidId,
      raidName: content.raidName,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      totalBossCount: content.totalBossCount,
    })),
  };
}

function compareCandidates(
  left: RosterAssistantBoosterCandidate,
  right: RosterAssistantBoosterCandidate,
): number {
  const leftIlvl = left.itemLevel ?? -1;
  const rightIlvl = right.itemLevel ?? -1;
  if (rightIlvl !== leftIlvl) return rightIlvl - leftIlvl;
  const byName = left.characterName.localeCompare(right.characterName, "en-US", {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  return left.characterId.localeCompare(right.characterId);
}

function pickConcreteRole(
  option: EligibleBoosterOption,
  bucket: "TANK" | "HEALER" | "DPS",
): CharacterRole | null {
  if (bucket === "TANK") return option.roles.includes("TANK") ? "TANK" : null;
  if (bucket === "HEALER") return option.roles.includes("HEALER") ? "HEALER" : null;
  if (option.defaultRole && isDpsRole(option.defaultRole)) return option.defaultRole;
  const melee = option.roles.find((role) => role === "MELEE_DPS");
  if (melee) return melee;
  const ranged = option.roles.find((role) => role === "RANGED_DPS");
  return ranged ?? null;
}

function alreadyStaffedSets(run: RunListRecord): {
  boosterUserIds: Set<string>;
  selectedLootbuddySignupIds: Set<string>;
} {
  /** Run list projection omits Character ids; booster userId is the staffing identity. */
  const boosterUserIds = new Set<string>();
  const selectedLootbuddySignupIds = new Set<string>();
  const byId = new Map(run.signups.map((signup) => [signup.id, signup]));
  const usePublished =
    run.status === "PUBLISHED" || run.status === "IN_PROGRESS" || run.status === "COMPLETED";

  if (usePublished) {
    for (const signup of run.signups) {
      if (signup.status !== "SELECTED") continue;
      if (signup.participationType === "BOOSTER") {
        boosterUserIds.add(signup.userId);
      } else if (signup.participationType === "LOOTBUDDY") {
        selectedLootbuddySignupIds.add(signup.id);
      }
    }
  } else {
    for (const selection of run.roster?.selections ?? []) {
      if (!selection.selected) continue;
      const signup = byId.get(selection.signupId);
      if (!signup) continue;
      if (signup.participationType === "BOOSTER") {
        boosterUserIds.add(signup.userId);
      } else if (signup.participationType === "LOOTBUDDY") {
        selectedLootbuddySignupIds.add(signup.id);
      }
    }
  }

  return { boosterUserIds, selectedLootbuddySignupIds };
}

/**
 * Deterministic, read-only Roster Assistant.
 * Reuses #210 staffing shortages + evaluateBoosterOptions eligibility.
 * Booster access is account-level User.isBooster (not per role/difficulty).
 * Aggregate DPS only — Melee/Ranged remain concrete labels, never quotas.
 * Lootbuddy candidates are unselected LOOTBUDDY signups (existing pickable authority).
 */
export const rosterAssistantService = {
  async getRosterAssistant(
    user: AuthenticatedUser,
    runId: string,
  ): Promise<RosterAssistantResult> {
    const [run] = await runRepository.listManagedByIds([runId]);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);

    const staffing = projectRunStaffingFromRun(run);
    const shortages = staffing.missing;
    const fullyStaffed = staffing.status === "FULLY_STAFFED";

    const empty: RosterAssistantResult = {
      run: {
        id: run.id,
        title: run.title,
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        difficulty: run.difficulty,
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
      },
      staffing,
      shortages,
      fullyStaffed,
      candidates: { tanks: [], healers: [], dps: [], lootbuddies: [] },
      excluded: [],
    };

    if (fullyStaffed) {
      return empty;
    }

    const staffed = alreadyStaffedSets(run);
    const pool = await characterRepository.listActiveBoosterCharacters();
    const candidatePool = pool.filter(
      (character) => !staffed.boosterUserIds.has(character.userId),
    );

    const enriched = await withSignupEligibilityContext(
      candidatePool,
      run.id,
      run.scheduledStartAt,
      run.difficulty,
    );

    const { eligible, ineligible } = evaluateBoosterOptions(enriched, toEligibilityRun(run));
    const byCharacterId = new Map(candidatePool.map((row) => [row.id, row]));

    const tanks: RosterAssistantBoosterCandidate[] = [];
    const healers: RosterAssistantBoosterCandidate[] = [];
    const dps: RosterAssistantBoosterCandidate[] = [];

    for (const option of eligible) {
      const source = byCharacterId.get(option.characterId);
      if (!source) continue;
      const lockoutAttention = option.contentSaves.some(
        (save) => save.raidSave != null && (save.raidSave.isComplete || save.raidSave.bossesDefeated > 0),
      );
      const base = {
        characterId: option.characterId,
        characterName: option.characterName,
        realm: option.realm,
        wowClass: option.wowClass,
        specialization: option.specialization,
        roles: option.roles,
        itemLevel: source.itemLevel,
        ownerUserId: source.userId,
        ownerName: source.ownerName,
        lockoutAttention,
      };

      if (shortages.tanks > 0) {
        const concreteRole = pickConcreteRole(option, "TANK");
        if (concreteRole) tanks.push({ ...base, concreteRole });
      }
      if (shortages.healers > 0) {
        const concreteRole = pickConcreteRole(option, "HEALER");
        if (concreteRole) healers.push({ ...base, concreteRole });
      }
      if (shortages.dps > 0) {
        const concreteRole = pickConcreteRole(option, "DPS");
        if (concreteRole) dps.push({ ...base, concreteRole });
      }
    }

    tanks.sort(compareCandidates);
    healers.sort(compareCandidates);
    dps.sort(compareCandidates);

    const lootbuddies: RosterAssistantLootbuddyCandidate[] = [];
    if (shortages.lootbuddies > 0) {
      for (const signup of run.signups) {
        if (signup.participationType !== "LOOTBUDDY") continue;
        if (signup.status === "WITHDRAWN") continue;
        if (staffed.selectedLootbuddySignupIds.has(signup.id)) continue;
        lootbuddies.push({
          signupId: signup.id,
          userId: signup.userId,
          userName: signup.userName,
          lootbuddyClass: signup.lootbuddyClass,
        });
      }
      lootbuddies.sort((left, right) =>
        left.userName.localeCompare(right.userName, "en-US", { sensitivity: "base" }),
      );
    }

    return {
      ...empty,
      candidates: { tanks, healers, dps, lootbuddies },
      excluded: ineligible,
    };
  },
};
