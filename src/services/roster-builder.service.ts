import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun } from "@/auth/authorization";
import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { DomainError } from "@/lib/errors";
import {
  projectRunStaffingFromRun,
  type RunStaffingProjection,
  type RunStaffingShortage,
} from "@/lib/run-staffing";
import { resolveSignupAssignableRoles } from "@/lib/signup-assignable-roles";
import { wclPerformanceMetricValue } from "@/lib/wcl-performance-display";
import type { CharacterRole, RunStatus } from "@/models/enums";
import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { getScheduleConflictsForCharacters } from "@/services/character-schedule-conflict.service";
import { resolveRosterWclPerformance } from "@/services/character-wcl-performance.service";
import {
  optimizeRosterProposal,
  type RosterBuilderCandidateInput,
  type RosterBuilderLockedPick,
  type RosterBuilderOptimizeResult,
  type RosterBuilderProposedPick,
} from "@/services/roster-builder-optimizer";
import { isApprovedBooster } from "@/services/boosting-role.service";
import { projectRosterSignupContentSaves, rosterService } from "@/services/roster.service";
import {
  classifyRosterSelectionRisk,
  lockoutAttentionWarning,
  type ConfirmedRosterWarning,
  formatWarningContentProgress,
  type RosterSelectionWarning,
} from "@/services/roster-selection-risk";
import { isActiveSignupOffer } from "@/services/signup-state";

const EDITABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

export type RosterBuilderResult = {
  run: {
    id: string;
    title: string;
    productLabel: string;
    contentSummary: string;
    difficulty: string;
    lootType: string;
    scheduledStartAt: string;
    status: RunStatus;
  };
  rosterVersion: number;
  staffing: RunStaffingProjection;
  shortages: RunStaffingShortage;
  fullyStaffed: boolean;
  proposed: RosterBuilderProposedPick[];
  /** New picks only — Apply merges these onto locked existing selections. */
  applySelections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
  /** Full draft selections after Apply (locked + proposed new). */
  fullSelections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
  unselected: RosterBuilderOptimizeResult["unselected"];
  buffCoverage: RosterBuilderOptimizeResult["buffCoverage"];
  missingAfterProposal: RunStaffingShortage;
  /**
   * NEW picks that need the Raid Lead's confirmation before Apply — one entry
   * per signup, each with per-RunRaidContent details from the shared roster
   * selection risk. Existing (locked) selections never appear here.
   */
  warnings: RosterBuilderWarning[];
  observability: RosterBuilderOptimizeResult["observability"];
};

export type RosterBuilderWarning = {
  signupId: string;
  characterId: string;
  /** e.g. "Synmist-Antonidas". */
  characterLabel: string;
  message: string;
  warning: RosterSelectionWarning;
};

function mapAccountStatus(value: unknown): "ACTIVE" | "DISABLED" {
  return value === "DISABLED" ? "DISABLED" : "ACTIVE";
}

async function loadAccountStatusByUserIds(userIds: string[]): Promise<Map<string, "ACTIVE" | "DISABLED">> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = (await orm.User.where((user) => user.id.in(unique))
    .select("id", "accountStatus")
    .all()) as Array<Record<string, unknown>>;
  return new Map(
    rows.map((row) => [asString(row.id), mapAccountStatus(row.accountStatus)]),
  );
}

/**
 * Lockout warning for a signup's Character on this Run, from the shared roster
 * selection risk (same per-content projection + loot-type semantics as the
 * roster cards). Null = nothing to confirm (unsaved, unknown, or a SAVED Run).
 */
function lockoutWarningFor(
  signup: RosterSignupRow,
  run: Parameters<typeof projectRosterSignupContentSaves>[1],
): RosterSelectionWarning | null {
  if (signup.participationType !== "BOOSTER" || !signup.character) return null;
  return lockoutAttentionWarning(projectRosterSignupContentSaves(signup, run));
}

function wclPctForRoles(
  segments: import("@/lib/wcl-performance-display").WclPerformanceRaidSegment[],
  roles: CharacterRole[],
): Partial<Record<CharacterRole, number | null>> {
  const out: Partial<Record<CharacterRole, number | null>> = {};
  for (const role of roles) {
    const avg = wclPerformanceMetricValue(segments, role, "avg");
    const best = wclPerformanceMetricValue(segments, role, "best");
    out[role] = avg ?? best;
  }
  return out;
}

function selectedLockedFromRoster(
  runStatus: RunStatus,
  signups: RosterSignupRow[],
  selectedSignupIds: string[],
  selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>,
): Array<{ signup: RosterSignupRow; selectedRole: CharacterRole | null }> {
  const byId = new Map(signups.map((signup) => [signup.id, signup]));
  const roleById = new Map(selections.map((row) => [row.signupId, row.selectedRole]));
  const usePublished =
    runStatus === "PUBLISHED" || runStatus === "IN_PROGRESS" || runStatus === "COMPLETED";

  if (usePublished) {
    return signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => ({
        signup,
        selectedRole:
          signup.participationType === "LOOTBUDDY" ? null : signup.publishedRole,
      }));
  }

  return selectedSignupIds
    .map((signupId) => {
      const signup = byId.get(signupId);
      if (!signup || !isActiveSignupOffer(signup.status)) return null;
      return {
        signup,
        selectedRole:
          signup.participationType === "LOOTBUDDY" ? null : (roleById.get(signupId) ?? signup.selectedRole),
      };
    })
    .filter((row): row is { signup: RosterSignupRow; selectedRole: CharacterRole | null } => row != null);
}

/**
 * Deterministic Roster Builder — proposes picks from actual Run signups only.
 * Opening never mutates; Apply uses rosterService.saveDraftSelection.
 */
export const rosterBuilderService = {
  async proposeRoster(user: AuthenticatedUser, runId: string): Promise<RosterBuilderResult> {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "This run cannot be rostered in its current state.",
      );
    }

    const roster = await rosterRepository.ensure(runId);
    const signups = await rosterRepository.listSignups(runId);
    const accountStatusByUser = await loadAccountStatusByUserIds(signups.map((row) => row.userId));

    const staffingRun = {
      status: run.status,
      signups: signups.map((signup) => ({
        id: signup.id,
        status: signup.status,
        participationType: signup.participationType,
        publishedRole: signup.publishedRole,
      })),
      roster: {
        selections: roster.selections.map((selection) => ({
          signupId: selection.signupId,
          selected: true,
          selectedRole: selection.selectedRole,
        })),
        externalBoosters: roster.externalBoosters.map((booster) => ({
          participationType: booster.participationType,
          role: booster.role,
        })),
      },
      desiredTankCount: run.desiredTankCount,
      desiredHealerCount: run.desiredHealerCount,
      desiredDpsCount: run.desiredDpsCount,
      desiredLootbuddyCount: run.desiredLootbuddyCount,
    };
    const staffing = projectRunStaffingFromRun(staffingRun);
    const shortages = staffing.missing;
    const fullyStaffed = staffing.status === "FULLY_STAFFED";

    const emptyBase = {
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
      rosterVersion: roster.version,
      staffing,
      shortages,
      fullyStaffed,
      proposed: [] as RosterBuilderProposedPick[],
      applySelections: [] as Array<{ signupId: string; selectedRole: CharacterRole | null }>,
      fullSelections: [] as Array<{ signupId: string; selectedRole: CharacterRole | null }>,
      unselected: [] as RosterBuilderOptimizeResult["unselected"],
      buffCoverage: {
        coveredCount: 0,
        totalCount: 0,
        missingCount: 0,
        buffs: [],
      } as RosterBuilderOptimizeResult["buffCoverage"],
      missingAfterProposal: shortages,
      warnings: [] as RosterBuilderWarning[],
      observability: {
        candidateCount: 0,
        selectedCount: 0,
        lockedCount: 0,
        newlySelectedCount: 0,
        utilityCoverage: { covered: 0, total: 0 },
        wclDataPresentCount: 0,
      },
    };

    const lockedRows = selectedLockedFromRoster(
      run.status,
      signups,
      roster.selectedSignupIds,
      roster.selections,
    );

    if (fullyStaffed) {
      const lockedProposed: RosterBuilderProposedPick[] = lockedRows.map((row) => ({
        signupId: row.signup.id,
        userId: row.signup.userId,
        userName: row.signup.userName,
        participationType: row.signup.participationType,
        selectedRole: row.selectedRole,
        bucket:
          row.signup.participationType === "LOOTBUDDY"
            ? "LOOTBUDDY"
            : row.selectedRole === "TANK"
              ? "TANK"
              : row.selectedRole === "HEALER"
                ? "HEALER"
                : "DPS",
        wowClass:
          row.signup.participationType === "LOOTBUDDY"
            ? row.signup.lootbuddyClass
            : (row.signup.character?.wowClass ?? null),
        characterName: row.signup.character?.name ?? null,
        itemLevel: row.signup.character?.itemLevel ?? null,
        wclPct: null,
        lockoutAttention: lockoutWarningFor(row.signup, run) != null,
        utilitiesProvided: [],
        reasons: ["locked_existing"],
        reasonLabels: ["Already selected"],
        locked: true,
        debugScore: 0,
      }));
      return {
        ...emptyBase,
        proposed: lockedProposed,
        fullSelections: lockedRows.map((row) => ({
          signupId: row.signup.id,
          selectedRole: row.selectedRole,
        })),
        observability: {
          ...emptyBase.observability,
          selectedCount: lockedProposed.length,
          lockedCount: lockedProposed.length,
        },
      };
    }

    const boosterCharacters = signups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.character)
      .map((signup) => ({
        id: signup.character!.id,
        name: signup.character!.name,
        region: signup.character!.region,
      }));

    const [scheduleConflictsByCharacter, wclBySignup] = await Promise.all([
      getScheduleConflictsForCharacters({
        targetRunId: run.id,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        characters: boosterCharacters,
      }),
      resolveRosterWclPerformance({
        difficulty: run.difficulty,
        contents: run.contents,
        allowRemoteFetch: false,
        boosters: signups
          .filter((signup) => signup.participationType === "BOOSTER" && signup.character)
          .map((signup) => ({
            signupId: signup.id,
            offeredRoles: signup.offeredRoles,
            character: {
              id: signup.character!.id,
              wowClass: signup.character!.wowClass,
              specialization: signup.character!.specialization,
              primaryRole: signup.character!.primaryRole,
              warcraftLogsId: signup.character!.warcraftLogsId,
            },
          })),
      }),
    ]);

    const lockedSignupIds = new Set(lockedRows.map((row) => row.signup.id));
    const lockedBoosterUserIds = new Set(
      lockedRows
        .filter((row) => row.signup.participationType === "BOOSTER")
        .map((row) => row.signup.userId),
    );

    const locked: RosterBuilderLockedPick[] = lockedRows.map((row) => {
      const segments = wclBySignup.get(row.signup.id) ?? [];
      const wclPct =
        row.selectedRole != null
          ? (wclPerformanceMetricValue(segments, row.selectedRole, "avg") ??
            wclPerformanceMetricValue(segments, row.selectedRole, "best"))
          : null;
      return {
        signupId: row.signup.id,
        userId: row.signup.userId,
        userName: row.signup.userName,
        participationType: row.signup.participationType,
        selectedRole: row.selectedRole,
        wowClass:
          row.signup.participationType === "LOOTBUDDY"
            ? (row.signup.lootbuddyClass ?? row.signup.character?.wowClass ?? null)
            : (row.signup.character?.wowClass ?? null),
        characterName: row.signup.character?.name ?? null,
        itemLevel: row.signup.character?.itemLevel ?? null,
        wclPct,
        lockoutAttention: lockoutWarningFor(row.signup, run) != null,
        lootbuddyMode: row.signup.lootbuddyMode,
      };
    });

    const candidates: RosterBuilderCandidateInput[] = [];
    const warningBySignupId = new Map<string, RosterBuilderWarning>();
    for (const signup of signups) {
      if (lockedSignupIds.has(signup.id)) continue;
      // WITHDRAWN never; NOT_SELECTED remains re-selectable (same as roster management).
      if (signup.status === "WITHDRAWN") continue;
      if (accountStatusByUser.get(signup.userId) === "DISABLED") continue;

      if (signup.participationType === "LOOTBUDDY") {
        candidates.push({
          signupId: signup.id,
          userId: signup.userId,
          userName: signup.userName,
          participationType: "LOOTBUDDY",
          assignableRoles: [],
          primaryRole: null,
          offspecRoles: [],
          wowClass: signup.lootbuddyClass ?? signup.character?.wowClass ?? null,
          characterName: signup.character?.name ?? null,
          itemLevel: signup.character?.itemLevel ?? null,
          wclByRole: {},
          lockoutAttention: false,
          lootbuddyMode: signup.lootbuddyMode,
        });
        continue;
      }

      if (signup.participationType !== "BOOSTER") continue;
      if (lockedBoosterUserIds.has(signup.userId)) continue;
      if (!signup.character?.isActive) continue;
      if (!isApprovedBooster({ isBooster: signup.character.ownerIsBooster })) continue;
      if (signup.offeredRoles.length === 0) continue;

      // Shared CLEAN / WARNING / BLOCKED: BLOCKED (cross-Run reservation, weekly
      // unavailability) is never proposed; WARNING stays a normal candidate —
      // it is not scored down — and is confirmed once, in aggregate, on Apply.
      const risk = classifyRosterSelectionRisk({
        scheduleConflicts: scheduleConflictsByCharacter.get(signup.character.id) ?? [],
        contentSaves: projectRosterSignupContentSaves(signup, run),
      });
      if (risk.level === "BLOCKED") continue;
      const lockoutWarning = risk.warnings.find((row) => row.type === "LOCKOUT_ATTENTION") ?? null;
      if (lockoutWarning) {
        warningBySignupId.set(signup.id, {
          signupId: signup.id,
          characterId: signup.character.id,
          characterLabel: `${signup.character.name}-${signup.character.realm}`,
          message: `${signup.character.name}-${signup.character.realm} has lockout progress: ${lockoutWarning.contents
            .map((content) => `${content.raidName} ${formatWarningContentProgress(content)}`)
            .join(", ")}.`,
          warning: lockoutWarning,
        });
      }

      const assignableRoles = resolveSignupAssignableRoles({
        offeredRoles: signup.offeredRoles,
        characterClass: signup.character.wowClass,
        primarySpecialization: signup.character.specialization,
        playableSpecs: signup.character.playableSpecs,
      }).filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role));

      if (assignableRoles.length === 0) continue;

      const segments = wclBySignup.get(signup.id) ?? [];
      candidates.push({
        signupId: signup.id,
        userId: signup.userId,
        userName: signup.userName,
        participationType: "BOOSTER",
        assignableRoles,
        primaryRole: signup.character.primaryRole,
        offspecRoles: signup.character.offspecRoles,
        wowClass: signup.character.wowClass,
        characterName: signup.character.name,
        itemLevel: signup.character.itemLevel,
        wclByRole: wclPctForRoles(segments, assignableRoles),
        lockoutAttention: lockoutWarning != null,
        lootbuddyMode: null,
      });
    }

    const optimized = optimizeRosterProposal({
      shortages,
      locked,
      externals: roster.externalBoosters.map((booster) => ({
        id: booster.id,
        name: booster.name,
        participationType: booster.participationType,
        role: booster.role,
        wowClass: booster.wowClass,
      })),
      candidates,
    });

    const newlyProposed = optimized.proposed.filter((row) => !row.locked);
    const applySelections = newlyProposed.map((row) => ({
      signupId: row.signupId,
      selectedRole: row.selectedRole,
    }));
    const fullSelections = optimized.proposed.map((row) => ({
      signupId: row.signupId,
      selectedRole: row.selectedRole,
    }));

    const warnings = newlyProposed
      .map((row) => warningBySignupId.get(row.signupId))
      .filter((row): row is RosterBuilderWarning => row != null);

    return {
      ...emptyBase,
      proposed: optimized.proposed,
      applySelections,
      fullSelections,
      unselected: optimized.unselected,
      buffCoverage: optimized.buffCoverage,
      missingAfterProposal: optimized.missingAfterProposal,
      warnings,
      observability: optimized.observability,
    };
  },

  /**
   * Apply a previously generated proposal.
   * Re-proposes server-side and requires the new-pick set to match (stale guard),
   * then persists via saveDraftSelection (existing locked + new), which
   * validates warning acknowledgements for the new picks.
   */
  async applyRosterProposal(
    user: AuthenticatedUser,
    input: {
      runId: string;
      expectedVersion: number;
      selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
      /** The ONE aggregate acknowledgement for every proposed pick with a warning. */
      confirmedWarnings?: ConfirmedRosterWarning[];
    },
  ): Promise<RosterBuilderResult> {
    const fresh = await this.proposeRoster(user, input.runId);
    if (fresh.rosterVersion !== input.expectedVersion) {
      throw new DomainError(
        "ROSTER_ALREADY_CHANGED",
        "This roster changed since you generated the proposal. Regenerate and try again.",
      );
    }

    const expectedNew = [...fresh.applySelections].sort((a, b) =>
      a.signupId.localeCompare(b.signupId),
    );
    const submittedNew = [...input.selections].sort((a, b) =>
      a.signupId.localeCompare(b.signupId),
    );
    if (expectedNew.length !== submittedNew.length) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "The proposal is no longer valid. Regenerate Auto Build Roster and try again.",
      );
    }
    for (let i = 0; i < expectedNew.length; i += 1) {
      const left = expectedNew[i]!;
      const right = submittedNew[i]!;
      if (left.signupId !== right.signupId || left.selectedRole !== right.selectedRole) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          "The proposal is no longer valid. Regenerate Auto Build Roster and try again.",
        );
      }
    }

    await rosterService.saveDraftSelection(user, {
      runId: input.runId,
      version: input.expectedVersion,
      selections: fresh.fullSelections,
      // saveDraftSelection recomputes each NEW pick's current risk: a hard
      // conflict rejects regardless, a new/changed warning needs a matching
      // acknowledgement, and the repository's locked reservation re-read
      // (PR #218) remains the final authority.
      confirmedWarnings: input.confirmedWarnings,
    });

    return this.proposeRoster(user, input.runId);
  },
};
