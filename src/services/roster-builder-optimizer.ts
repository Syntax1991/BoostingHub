import { isDpsRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import {
  ROSTER_BUILDER_BUFF_IMPORTANCE,
  ROSTER_BUILDER_ILVL_WEIGHT,
  ROSTER_BUILDER_OFFSPEC_ROLE_WEIGHT,
  ROSTER_BUILDER_PRIMARY_ROLE_WEIGHT,
  ROSTER_BUILDER_UTILITY_DUPLICATE_WEIGHT,
  ROSTER_BUILDER_WCL_HEALER_WEIGHT,
  ROSTER_BUILDER_WCL_WEIGHT,
} from "@/lib/roster-builder-weights";
import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";
import {
  evaluateRaidBuffCoverage,
  RAID_BUFF_DEFINITIONS,
  type RaidBuffCoverage,
  type RaidBuffId,
  type RaidBuffParticipant,
} from "@/services/roster-raid-buffs";

export type RosterBuilderBucket = "TANK" | "HEALER" | "DPS" | "LOOTBUDDY";

export type RosterBuilderShortage = {
  tanks: number;
  healers: number;
  dps: number;
  lootbuddies: number;
};

export type RosterBuilderCandidateInput = {
  signupId: string;
  userId: string;
  userName: string;
  participationType: ParticipationType;
  /** Concrete assignable roles from offered signup roles (never invent offspecs). */
  assignableRoles: ConcreteCharacterRole[];
  /** Character primary role — soft preference when assignable. */
  primaryRole: CharacterRole | null;
  /** Preferred offspec roles — soft preference below primary when assignable. */
  offspecRoles: readonly CharacterRole[];
  wowClass: WowClass | null;
  characterName: string | null;
  itemLevel: number | null;
  /** Soft WCL signal 0..100 for the role key (concrete or aggregate DPS). */
  wclByRole: Partial<Record<CharacterRole, number | null>>;
  lockoutAttention: boolean;
  lootbuddyMode: RaidBuffParticipant["lootbuddyMode"];
};

export type RosterBuilderLockedPick = {
  signupId: string;
  userId: string;
  userName: string;
  participationType: ParticipationType;
  selectedRole: CharacterRole | null;
  wowClass: WowClass | null;
  characterName: string | null;
  itemLevel: number | null;
  wclPct: number | null;
  lockoutAttention: boolean;
  lootbuddyMode: RaidBuffParticipant["lootbuddyMode"];
};

export type RosterBuilderExternal = {
  id: string;
  name: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  wowClass: WowClass | null;
};

export type RosterBuilderSelectionReason =
  | "fills_slot"
  | "provides_utility"
  | "strong_wcl"
  | "item_level"
  | "only_eligible"
  | "locked_existing";

export type RosterBuilderProposedPick = {
  signupId: string;
  userId: string;
  userName: string;
  participationType: ParticipationType;
  selectedRole: CharacterRole | null;
  bucket: RosterBuilderBucket;
  wowClass: WowClass | null;
  characterName: string | null;
  itemLevel: number | null;
  wclPct: number | null;
  lockoutAttention: boolean;
  utilitiesProvided: RaidBuffId[];
  reasons: RosterBuilderSelectionReason[];
  reasonLabels: string[];
  locked: boolean;
  debugScore: number;
};

export type RosterBuilderUnselected = {
  signupId: string;
  userId: string;
  userName: string;
  participationType: ParticipationType;
  assignableRoles: ConcreteCharacterRole[];
  wowClass: WowClass | null;
  characterName: string | null;
  itemLevel: number | null;
  wclPct: number | null;
  lockoutAttention: boolean;
  utilities: RaidBuffId[];
  skipReason: string;
};

export type RosterBuilderOptimizeResult = {
  proposed: RosterBuilderProposedPick[];
  unselected: RosterBuilderUnselected[];
  buffCoverage: RaidBuffCoverage;
  missingAfterProposal: RosterBuilderShortage;
  observability: {
    candidateCount: number;
    selectedCount: number;
    lockedCount: number;
    newlySelectedCount: number;
    utilityCoverage: { covered: number; total: number };
    wclDataPresentCount: number;
  };
};

type WorkingPick = {
  candidate: RosterBuilderCandidateInput | null;
  locked: RosterBuilderLockedPick | null;
  selectedRole: CharacterRole | null;
  bucket: RosterBuilderBucket;
  utilitiesProvided: RaidBuffId[];
  wclPct: number | null;
  reasons: RosterBuilderSelectionReason[];
  debugScore: number;
};

function utilitiesForClass(wowClass: WowClass | null): RaidBuffId[] {
  if (!wowClass) return [];
  return RAID_BUFF_DEFINITIONS.filter((definition) =>
    definition.providerClasses.includes(wowClass),
  ).map((definition) => definition.id);
}

function bucketForRole(role: CharacterRole | null, participationType: ParticipationType): RosterBuilderBucket | null {
  if (participationType === "LOOTBUDDY") return "LOOTBUDDY";
  if (role === "TANK") return "TANK";
  if (role === "HEALER") return "HEALER";
  if (role != null && isDpsRole(role)) return "DPS";
  return null;
}

function rolesForBucket(candidate: RosterBuilderCandidateInput, bucket: RosterBuilderBucket): CharacterRole[] {
  if (bucket === "LOOTBUDDY") return [];
  if (bucket === "TANK") return candidate.assignableRoles.filter((role) => role === "TANK");
  if (bucket === "HEALER") return candidate.assignableRoles.filter((role) => role === "HEALER");
  return candidate.assignableRoles.filter((role) => isDpsRole(role));
}

function rolePreferenceRank(
  candidate: RosterBuilderCandidateInput,
  role: CharacterRole,
): number {
  if (candidate.primaryRole === role) return 2;
  if (candidate.offspecRoles.includes(role)) return 1;
  return 0;
}

function pickRoleForBucket(candidate: RosterBuilderCandidateInput, bucket: RosterBuilderBucket): CharacterRole | null {
  const roles = rolesForBucket(candidate, bucket);
  if (bucket === "LOOTBUDDY") return null;
  if (roles.length === 0) return null;
  if (bucket === "DPS") {
    // Prefer primary, then preferred offspec, then WCL / stable MELEE→RANGED.
    const melee = roles.find((role) => role === "MELEE_DPS");
    const ranged = roles.find((role) => role === "RANGED_DPS");
    if (melee && ranged) {
      const meleeRank = rolePreferenceRank(candidate, melee);
      const rangedRank = rolePreferenceRank(candidate, ranged);
      if (meleeRank !== rangedRank) return meleeRank > rangedRank ? melee : ranged;
      const meleeWcl = candidate.wclByRole.MELEE_DPS ?? null;
      const rangedWcl = candidate.wclByRole.RANGED_DPS ?? null;
      if (meleeWcl != null && rangedWcl != null) return meleeWcl >= rangedWcl ? melee : ranged;
      if (meleeWcl != null) return melee;
      if (rangedWcl != null) return ranged;
      return melee;
    }
    return melee ?? ranged ?? roles[0]!;
  }
  // Tank / Healer: prefer primary match when both somehow present (defensive).
  const preferred = [...roles].sort(
    (left, right) => rolePreferenceRank(candidate, right) - rolePreferenceRank(candidate, left),
  );
  return preferred[0]!;
}

function rolePreferenceScore(
  candidate: RosterBuilderCandidateInput,
  role: CharacterRole | null,
): number {
  if (role == null) return 0;
  if (candidate.primaryRole === role) return ROSTER_BUILDER_PRIMARY_ROLE_WEIGHT;
  if (candidate.offspecRoles.includes(role)) return ROSTER_BUILDER_OFFSPEC_ROLE_WEIGHT;
  return 0;
}

function wclForRole(candidate: RosterBuilderCandidateInput, role: CharacterRole | null): number | null {
  if (role == null) return null;
  if (isDpsRole(role)) {
    return (
      candidate.wclByRole[role] ??
      candidate.wclByRole.MELEE_DPS ??
      candidate.wclByRole.RANGED_DPS ??
      candidate.wclByRole.DPS ??
      null
    );
  }
  return candidate.wclByRole[role] ?? null;
}

function softWclWeight(role: CharacterRole | null): number {
  if (role === "HEALER") return ROSTER_BUILDER_WCL_HEALER_WEIGHT;
  return ROSTER_BUILDER_WCL_WEIGHT;
}

function coveredUtilitySet(participants: RaidBuffParticipant[]): Set<RaidBuffId> {
  const coverage = evaluateRaidBuffCoverage(participants);
  return new Set(coverage.buffs.filter((buff) => buff.covered).map((buff) => buff.id));
}

function toBuffParticipant(input: {
  signupId: string;
  userName: string;
  participationType: ParticipationType;
  lootbuddyMode: RaidBuffParticipant["lootbuddyMode"];
  wowClass: WowClass | null;
  characterName: string | null;
}): RaidBuffParticipant {
  return {
    signupId: input.signupId,
    userName: input.userName,
    participationType: input.participationType,
    lootbuddyMode: input.lootbuddyMode,
    wowClass: input.wowClass,
    characterName: input.characterName,
  };
}

function marginalUtilityScore(
  wowClass: WowClass | null,
  alreadyCovered: Set<RaidBuffId>,
): { score: number; provided: RaidBuffId[] } {
  const provided: RaidBuffId[] = [];
  let score = 0;
  for (const utilityId of utilitiesForClass(wowClass)) {
    if (alreadyCovered.has(utilityId)) {
      score += ROSTER_BUILDER_UTILITY_DUPLICATE_WEIGHT;
      continue;
    }
    provided.push(utilityId);
    score += ROSTER_BUILDER_BUFF_IMPORTANCE[utilityId] ?? 0;
  }
  return { score, provided };
}

function scoreCandidateAgainstCoverage(
  candidate: RosterBuilderCandidateInput,
  role: CharacterRole | null,
  alreadyCovered: Set<RaidBuffId>,
): { score: number; provided: RaidBuffId[]; wclPct: number | null } {
  const { score: utilScore, provided } = marginalUtilityScore(candidate.wowClass, alreadyCovered);
  const roleScore = rolePreferenceScore(candidate, role);
  const wclPct = wclForRole(candidate, role);
  const wclScore = (wclPct ?? 0) * softWclWeight(role);
  const ilvlScore = (candidate.itemLevel ?? 0) * ROSTER_BUILDER_ILVL_WEIGHT;
  return { score: utilScore + roleScore + wclScore + ilvlScore, provided, wclPct };
}

function compareCandidateOrder(
  left: RosterBuilderCandidateInput,
  right: RosterBuilderCandidateInput,
): number {
  const byName = left.userName.localeCompare(right.userName, "en-US", { sensitivity: "base" });
  if (byName !== 0) return byName;
  const leftChar = left.characterName ?? "";
  const rightChar = right.characterName ?? "";
  const byChar = leftChar.localeCompare(rightChar, "en-US", { sensitivity: "base" });
  if (byChar !== 0) return byChar;
  return left.signupId.localeCompare(right.signupId);
}

function buildReasons(input: {
  provided: RaidBuffId[];
  wclPct: number | null;
  itemLevel: number | null;
  bucket: RosterBuilderBucket;
  onlyEligible: boolean;
  locked: boolean;
}): { reasons: RosterBuilderSelectionReason[]; reasonLabels: string[] } {
  if (input.locked) {
    return { reasons: ["locked_existing"], reasonLabels: ["Already selected"] };
  }
  const reasons: RosterBuilderSelectionReason[] = ["fills_slot"];
  const reasonLabels: string[] = [
    input.bucket === "LOOTBUDDY"
      ? "Fills Lootbuddy slot"
      : `Fills ${input.bucket === "DPS" ? "DPS" : input.bucket.charAt(0) + input.bucket.slice(1).toLowerCase()} slot`,
  ];
  if (input.provided.length > 0) {
    reasons.push("provides_utility");
    const names = input.provided
      .map((id) => RAID_BUFF_DEFINITIONS.find((row) => row.id === id)?.name ?? id)
      .join(", ");
    reasonLabels.push(`Provides ${names}`);
  }
  if (input.wclPct != null && input.wclPct >= 75) {
    reasons.push("strong_wcl");
    reasonLabels.push(`WCL ${Math.round(input.wclPct)}`);
  } else if (input.wclPct != null) {
    reasonLabels.push(`WCL ${Math.round(input.wclPct)}`);
  }
  if (input.itemLevel != null) {
    reasons.push("item_level");
    reasonLabels.push(`ilvl ${input.itemLevel}`);
  }
  if (input.onlyEligible) {
    reasons.push("only_eligible");
    reasonLabels.push("Only eligible signup for this slot");
  }
  return { reasons, reasonLabels };
}

function shortageRemaining(
  need: RosterBuilderShortage,
  picks: WorkingPick[],
): RosterBuilderShortage {
  const staffed = { tanks: 0, healers: 0, dps: 0, lootbuddies: 0 };
  for (const pick of picks) {
    if (pick.bucket === "TANK") staffed.tanks += 1;
    else if (pick.bucket === "HEALER") staffed.healers += 1;
    else if (pick.bucket === "DPS") staffed.dps += 1;
    else staffed.lootbuddies += 1;
  }
  // `need` is remaining shortages at start; locked already accounted for by caller.
  // Here picks include locked + new — caller passes shortages already net of locked.
  // We only count NEW picks toward filling need.
  const newly = picks.filter((pick) => !pick.locked);
  const filled = { tanks: 0, healers: 0, dps: 0, lootbuddies: 0 };
  for (const pick of newly) {
    if (pick.bucket === "TANK") filled.tanks += 1;
    else if (pick.bucket === "HEALER") filled.healers += 1;
    else if (pick.bucket === "DPS") filled.dps += 1;
    else filled.lootbuddies += 1;
  }
  return {
    tanks: Math.max(0, need.tanks - filled.tanks),
    healers: Math.max(0, need.healers - filled.healers),
    dps: Math.max(0, need.dps - filled.dps),
    lootbuddies: Math.max(0, need.lootbuddies - filled.lootbuddies),
  };
}

/**
 * Deterministic roster proposal optimizer.
 *
 * Algorithm:
 * 1. Seed with locked existing picks + external boosters (buff coverage baseline).
 * 2. Greedy-fill remaining Tank → Healer → DPS → Lootbuddy shortages from Run signup candidates,
 *    maximizing marginal utility, then primary/offspec role preference, then WCL, then ilvl
 *    (stable name/id ties).
 * 3. Improvement swaps within each bucket until no swap raises total soft score.
 *
 * Hard constraints are enforced by the caller (eligible candidate universe only).
 * No Melee/Ranged quotas — DPS is aggregate.
 */
export function optimizeRosterProposal(input: {
  shortages: RosterBuilderShortage;
  locked: RosterBuilderLockedPick[];
  externals: RosterBuilderExternal[];
  candidates: RosterBuilderCandidateInput[];
}): RosterBuilderOptimizeResult {
  const lockedPicks: WorkingPick[] = [];
  for (const row of input.locked) {
    const bucket = bucketForRole(row.selectedRole, row.participationType);
    if (!bucket) continue;
    lockedPicks.push({
      candidate: null,
      locked: row,
      selectedRole: row.selectedRole,
      bucket,
      utilitiesProvided: utilitiesForClass(row.wowClass),
      wclPct: row.wclPct,
      reasons: ["locked_existing"],
      debugScore: 0,
    });
  }

  const baselineParticipants: RaidBuffParticipant[] = [
    ...lockedPicks.map((pick) => toBuffParticipant(pick.locked!)),
    ...input.externals.map((booster) =>
      toBuffParticipant({
        signupId: `external:${booster.id}`,
        userName: booster.name,
        participationType: booster.participationType,
        lootbuddyMode: null,
        wowClass: booster.wowClass,
        characterName: booster.name,
      }),
    ),
  ];

  const usedSignupIds = new Set(lockedPicks.map((pick) => pick.locked!.signupId));
  const usedBoosterUserIds = new Set(
    lockedPicks
      .filter((pick) => pick.locked!.participationType === "BOOSTER")
      .map((pick) => pick.locked!.userId),
  );

  const sortedCandidates = [...input.candidates].sort(compareCandidateOrder);
  const picks: WorkingPick[] = [...lockedPicks];

  const buckets: Array<{ bucket: RosterBuilderBucket; count: number }> = [
    { bucket: "TANK", count: input.shortages.tanks },
    { bucket: "HEALER", count: input.shortages.healers },
    { bucket: "DPS", count: input.shortages.dps },
    { bucket: "LOOTBUDDY", count: input.shortages.lootbuddies },
  ];

  for (const { bucket, count } of buckets) {
    for (let slot = 0; slot < count; slot += 1) {
      const covered = coveredUtilitySet([
        ...baselineParticipants,
        ...picks
          .filter((pick) => !pick.locked)
          .map((pick) =>
            toBuffParticipant({
              signupId: pick.candidate!.signupId,
              userName: pick.candidate!.userName,
              participationType: pick.candidate!.participationType,
              lootbuddyMode: pick.candidate!.lootbuddyMode,
              wowClass: pick.candidate!.wowClass,
              characterName: pick.candidate!.characterName,
            }),
          ),
      ]);

      let best: {
        candidate: RosterBuilderCandidateInput;
        role: CharacterRole | null;
        score: number;
        provided: RaidBuffId[];
        wclPct: number | null;
      } | null = null;

      for (const candidate of sortedCandidates) {
        if (usedSignupIds.has(candidate.signupId)) continue;
        if (bucket === "LOOTBUDDY") {
          if (candidate.participationType !== "LOOTBUDDY") continue;
        } else {
          if (candidate.participationType !== "BOOSTER") continue;
          if (usedBoosterUserIds.has(candidate.userId)) continue;
          if (rolesForBucket(candidate, bucket).length === 0) continue;
        }

        const role = pickRoleForBucket(candidate, bucket);
        if (bucket !== "LOOTBUDDY" && role == null) continue;
        const scored = scoreCandidateAgainstCoverage(candidate, role, covered);
        if (
          !best ||
          scored.score > best.score ||
          (scored.score === best.score && compareCandidateOrder(candidate, best.candidate) < 0)
        ) {
          best = {
            candidate,
            role,
            score: scored.score,
            provided: scored.provided,
            wclPct: scored.wclPct,
          };
        }
      }

      if (!best) break;

      usedSignupIds.add(best.candidate.signupId);
      if (best.candidate.participationType === "BOOSTER") {
        usedBoosterUserIds.add(best.candidate.userId);
      }
      picks.push({
        candidate: best.candidate,
        locked: null,
        selectedRole: best.role,
        bucket,
        utilitiesProvided: best.provided,
        wclPct: best.wclPct,
        reasons: [],
        debugScore: best.score,
      });
    }
  }

  // Improvement: try swaps within each bucket for newly selected picks until no better valid roster.
  let improved = true;
  while (improved) {
    improved = false;
    for (let index = 0; index < picks.length; index += 1) {
      const pick = picks[index]!;
      if (pick.locked) continue;
      const bucket = pick.bucket;

      for (const candidate of sortedCandidates) {
        if (candidate.signupId === pick.candidate!.signupId) continue;
        if (usedSignupIds.has(candidate.signupId)) continue;
        if (bucket === "LOOTBUDDY") {
          if (candidate.participationType !== "LOOTBUDDY") continue;
        } else {
          if (candidate.participationType !== "BOOSTER") continue;
          if (
            usedBoosterUserIds.has(candidate.userId) &&
            candidate.userId !== pick.candidate!.userId
          ) {
            continue;
          }
          if (rolesForBucket(candidate, bucket).length === 0) continue;
        }

        const role = pickRoleForBucket(candidate, bucket);
        if (bucket !== "LOOTBUDDY" && role == null) continue;

        const trial = picks.map((row) => ({ ...row }));
        const old = trial[index]!;
        trial[index] = {
          candidate,
          locked: null,
          selectedRole: role,
          bucket,
          utilitiesProvided: [],
          wclPct: wclForRole(candidate, role),
          reasons: [],
          debugScore: 0,
        };

        const beforeScore = softScoreWithExternals(picks, input.externals);
        const afterScore = softScoreWithExternals(trial, input.externals);
        if (afterScore <= beforeScore + 1e-9) continue;

        usedSignupIds.delete(old.candidate!.signupId);
        if (old.candidate!.participationType === "BOOSTER") {
          usedBoosterUserIds.delete(old.candidate!.userId);
        }
        usedSignupIds.add(candidate.signupId);
        if (candidate.participationType === "BOOSTER") {
          usedBoosterUserIds.add(candidate.userId);
        }
        const covered = coveredUtilitySet(buffParticipantsFromPicks(trial, input.externals));
        const scored = scoreCandidateAgainstCoverage(candidate, role, covered);
        trial[index] = {
          ...trial[index]!,
          utilitiesProvided: scored.provided,
          debugScore: scored.score,
          wclPct: scored.wclPct,
        };
        picks.splice(0, picks.length, ...trial);
        improved = true;
        break;
      }
      if (improved) break;
    }
  }

  // Finalize reasons / coverage
  const finalParticipants = buffParticipantsFromPicks(picks, input.externals);
  const buffCoverage = evaluateRaidBuffCoverage(finalParticipants);
  const coveredIds = new Set(buffCoverage.buffs.filter((buff) => buff.covered).map((buff) => buff.id));

  const proposed: RosterBuilderProposedPick[] = picks.map((pick) => {
    if (pick.locked) {
      const { reasons, reasonLabels } = buildReasons({
        provided: pick.utilitiesProvided.filter((id) => coveredIds.has(id)),
        wclPct: pick.wclPct,
        itemLevel: pick.locked.itemLevel,
        bucket: pick.bucket,
        onlyEligible: false,
        locked: true,
      });
      return {
        signupId: pick.locked.signupId,
        userId: pick.locked.userId,
        userName: pick.locked.userName,
        participationType: pick.locked.participationType,
        selectedRole: pick.selectedRole,
        bucket: pick.bucket,
        wowClass: pick.locked.wowClass,
        characterName: pick.locked.characterName,
        itemLevel: pick.locked.itemLevel,
        wclPct: pick.wclPct,
        lockoutAttention: pick.locked.lockoutAttention,
        utilitiesProvided: pick.utilitiesProvided,
        reasons,
        reasonLabels,
        locked: true,
        debugScore: pick.debugScore,
      };
    }

    const candidate = pick.candidate!;
    const sameBucketPool = sortedCandidates.filter((row) => {
      if (usedSignupIds.has(row.signupId) && row.signupId !== candidate.signupId) return false;
      if (pick.bucket === "LOOTBUDDY") return row.participationType === "LOOTBUDDY";
      return (
        row.participationType === "BOOSTER" &&
        rolesForBucket(row, pick.bucket).length > 0 &&
        (!usedBoosterUserIds.has(row.userId) || row.userId === candidate.userId)
      );
    });
    const { reasons, reasonLabels } = buildReasons({
      provided: pick.utilitiesProvided,
      wclPct: pick.wclPct,
      itemLevel: candidate.itemLevel,
      bucket: pick.bucket,
      onlyEligible: sameBucketPool.length <= 1,
      locked: false,
    });
    return {
      signupId: candidate.signupId,
      userId: candidate.userId,
      userName: candidate.userName,
      participationType: candidate.participationType,
      selectedRole: pick.selectedRole,
      bucket: pick.bucket,
      wowClass: candidate.wowClass,
      characterName: candidate.characterName,
      itemLevel: candidate.itemLevel,
      wclPct: pick.wclPct,
      lockoutAttention: candidate.lockoutAttention,
      utilitiesProvided: pick.utilitiesProvided,
      reasons,
      reasonLabels,
      locked: false,
      debugScore: pick.debugScore,
    };
  });

  const selectedIds = new Set(proposed.map((row) => row.signupId));
  const unselected: RosterBuilderUnselected[] = sortedCandidates
    .filter((row) => !selectedIds.has(row.signupId))
    .map((row) => {
      const primaryRole = row.assignableRoles[0] ?? null;
      const wclPct = wclForRole(row, primaryRole);
      let skipReason = "Not selected for remaining shortages";
      if (row.participationType === "BOOSTER" && usedBoosterUserIds.has(row.userId)) {
        skipReason = "Another booster signup for this user is selected";
      } else if (input.shortages.tanks + input.shortages.healers + input.shortages.dps + input.shortages.lootbuddies === 0) {
        skipReason = "Roster shortages already filled";
      } else {
        skipReason = "Lower roster score than selected alternatives";
      }
      return {
        signupId: row.signupId,
        userId: row.userId,
        userName: row.userName,
        participationType: row.participationType,
        assignableRoles: row.assignableRoles,
        wowClass: row.wowClass,
        characterName: row.characterName,
        itemLevel: row.itemLevel,
        wclPct,
        lockoutAttention: row.lockoutAttention,
        utilities: utilitiesForClass(row.wowClass),
        skipReason,
      };
    });

  const missingAfterProposal = shortageRemaining(input.shortages, picks);
  const newlySelectedCount = proposed.filter((row) => !row.locked).length;
  const wclDataPresentCount = proposed.filter((row) => row.wclPct != null).length;

  return {
    proposed,
    unselected,
    buffCoverage,
    missingAfterProposal,
    observability: {
      candidateCount: input.candidates.length,
      selectedCount: proposed.length,
      lockedCount: proposed.filter((row) => row.locked).length,
      newlySelectedCount,
      utilityCoverage: {
        covered: buffCoverage.coveredCount,
        total: buffCoverage.totalCount,
      },
      wclDataPresentCount,
    },
  };
}

function buffParticipantsFromPicks(
  picks: WorkingPick[],
  externals: RosterBuilderExternal[],
): RaidBuffParticipant[] {
  return [
    ...picks.map((pick) =>
      pick.locked
        ? toBuffParticipant(pick.locked)
        : toBuffParticipant({
            signupId: pick.candidate!.signupId,
            userName: pick.candidate!.userName,
            participationType: pick.candidate!.participationType,
            lootbuddyMode: pick.candidate!.lootbuddyMode,
            wowClass: pick.candidate!.wowClass,
            characterName: pick.candidate!.characterName,
          }),
    ),
    ...externals.map((booster) =>
      toBuffParticipant({
        signupId: `external:${booster.id}`,
        userName: booster.name,
        participationType: booster.participationType,
        lootbuddyMode: null,
        wowClass: booster.wowClass,
        characterName: booster.name,
      }),
    ),
  ];
}

function softScoreWithExternals(picks: WorkingPick[], externals: RosterBuilderExternal[]): number {
  const participants = buffParticipantsFromPicks(picks, externals);
  const covered = coveredUtilitySet(participants);
  let util = 0;
  for (const id of covered) {
    util += ROSTER_BUILDER_BUFF_IMPORTANCE[id] ?? 0;
  }
  let rolePref = 0;
  let wcl = 0;
  let ilvl = 0;
  for (const pick of picks) {
    if (pick.candidate) {
      rolePref += rolePreferenceScore(pick.candidate, pick.selectedRole);
    }
    wcl += (pick.wclPct ?? 0) * softWclWeight(pick.selectedRole);
    ilvl += (pick.locked?.itemLevel ?? pick.candidate?.itemLevel ?? 0) * ROSTER_BUILDER_ILVL_WEIGHT;
  }
  return util + rolePref + wcl + ilvl;
}
