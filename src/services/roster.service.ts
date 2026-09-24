import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun, canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  EXTERNAL_BOOSTERS_MAX_PER_ROSTER,
  externalBoosterInputError,
  normalizeExternalBoosterName,
  type ExternalBooster,
  type ExternalBoosterInput,
} from "@/lib/external-booster";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { lockoutService } from "@/services/lockout.service";
import { assertRunTransition, isSignupWindowOpen } from "@/services/run-state";
import { assertSignupTransition } from "@/services/signup-state";
import { validateRosterDraft, type RosterIssue, type RosterValidationResult } from "@/services/roster-validation";
import {
  evaluateRaidBuffCoverage,
  resolveBuffContributorClass,
  type RaidBuffCoverage,
  type RaidBuffParticipant,
} from "@/services/roster-raid-buffs";
import {
  assertCharacterSelectableForSchedule,
  assertRosterPublishableForSchedule,
  getScheduleConflictsForCharacter,
  getScheduleConflictsForCharacters,
  type CharacterScheduleConflict,
} from "@/services/character-schedule-conflict.service";
import {
  getRunCommitmentsForCharacters,
  type CharacterRunCommitment,
} from "@/services/character-run-commitment";
import { rosterRepository, type RosterSelection, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { activityRepository } from "@/repositories/activity.repository";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { formatOfferedRoles } from "@/lib/offered-roles";
import { rosterActionLabel } from "@/lib/run-routes";
import type { CharacterRole, ParticipationType, RaidDifficulty, RunLootType, RunStatus, SignupStatus, WowClass } from "@/models/enums";
import {
  projectRunContentLockouts,
  type RunContentRaidSaveInfo,
} from "@/lib/run-content-lockouts";
import type { RunRaidContentRecord } from "@/repositories/run.repository";
import {
  resolveRosterWclPerformance,
  type WclPerformanceRaidSegment,
} from "@/services/character-wcl-performance.service";

const EDITABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

type InspectedSignup = RosterSignupRow & {
  draftSelected: boolean;
  characterActive: boolean;
  boosterApproved: boolean;
  /** Informational per-content lockouts — never roster blockers. */
  contentSaves: RunContentRaidSaveInfo[];
  issue: string | null;
  /** Derived schedule integrity conflicts — never auto-withdraw or auto-deselect. */
  scheduleConflicts: CharacterScheduleConflict[];
  /**
   * Informational other-Run reservations (draft-selected or published SELECTED).
   * Never blocks selection by itself — see scheduleConflicts for blockers.
   */
  runCommitments: CharacterRunCommitment[];
  /** Informational WCL Best/Avg per Run content × offered role. */
  wclPerformance: WclPerformanceRaidSegment[];
};

/**
 * One UI projection of a signup into a role (or lootbuddy) section.
 * Multi-role BOOSTERs produce one card per offered role — visual duplication is
 * intentional. Domain identity stays `signup.id` (one staged/persisted slot).
 */
type RosterSignupCard = InspectedSignup & {
  /** Section this card is rendered in; null for LOOTBUDDY. */
  groupRole: CharacterRole | null;
};

/**
 * Discovery grouping: a hybrid offering Healer and DPS appears under both role
 * sections. Selection identity remains the signup id — never the projection.
 */
function boosterCardsFor(candidates: InspectedSignup[], role: CharacterRole): RosterSignupCard[] {
  return candidates
    .filter((item) => item.participationType === "BOOSTER" && item.offeredRoles.includes(role))
    .map((item) => ({
      ...item,
      groupRole: role,
    }));
}

/** Unique BOOSTER candidates — never flatten role projections to derive this. */
function canonicalBoosters(candidates: InspectedSignup[]): RosterSignupCard[] {
  return candidates
    .filter((item) => item.participationType === "BOOSTER")
    .map((item) => ({
      ...item,
      groupRole: null,
    }));
}

/** Prefer character name; characterless Lootbuddy falls back to Class label. */
function participationLabel(input: {
  character: { name: string; realm: string } | null;
  lootbuddyClass: WowClass | null;
}): string {
  if (input.character) {
    return `${input.character.name}-${input.character.realm}`;
  }
  if (input.lootbuddyClass) {
    return CLASS_LABELS[input.lootbuddyClass];
  }
  return "Unknown character";
}

function resolvedLootbuddyClass(signup: RosterSignupRow): WowClass | null {
  return signup.lootbuddyClass ?? signup.character?.wowClass ?? null;
}

/**
 * The Raid Lead's role assignment for one slot being selected. A BOOSTER slot
 * must end up with exactly one of the roles its offer volunteered — an offer
 * with only one such role resolves itself, so a raid lead never has to
 * restate the obvious. A LOOTBUDDY slot has no booster role at all.
 */
function resolveSelectedRole(
  signup: RosterSignupRow,
  requested: CharacterRole | null | undefined,
): CharacterRole | null {
  const label = participationLabel(signup);
  if (signup.participationType !== "BOOSTER") {
    if (requested) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `${label} is a lootbuddy entry and cannot be assigned a booster role.`,
      );
    }
    return null;
  }

  const role = requested ?? (signup.offeredRoles.length === 1 ? signup.offeredRoles[0] : null);
  if (!role) {
    throw new DomainError(
      "INVALID_ROSTER_SELECTION",
      signup.offeredRoles.length === 0
        ? `${label} offered no role and cannot be rostered as a booster.`
        : `Choose a role for ${label} — offered ${formatOfferedRoles(signup.offeredRoles)}.`,
    );
  }
  if (!signup.offeredRoles.includes(role)) {
    throw new DomainError(
      "INVALID_ROSTER_SELECTION",
      `${label} did not offer ${CHARACTER_ROLE_LABELS[role]}.`,
    );
  }
  return role;
}

function inspectSignup(
  signup: RosterSignupRow,
  run: {
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    lootType: RunLootType;
    contents: Array<Pick<RunRaidContentRecord, "raidId" | "raidName" | "sortOrder" | "plannedBossCount" | "totalBossCount">>;
  },
): Omit<InspectedSignup, "draftSelected" | "scheduleConflicts" | "runCommitments" | "wclPerformance"> {
  if (run.contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run has no configured raid contents.");
  }
  const character = signup.character;
  const contents = run.contents;
  const contentSaves =
    character == null
      ? projectRunContentLockouts({
          contents,
          difficulty: run.difficulty,
          lootType: run.lootType,
          findSave: () => null,
        })
      : projectRunContentLockouts({
          contents,
          difficulty: run.difficulty,
          lootType: run.lootType,
          findSave: (content) => {
            const matchingLockout = lockoutService.findExactLockout(character.lockouts, {
              raidId: content.raidId,
              difficulty: run.difficulty,
              resetIdentifier: lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt),
            });
            return matchingLockout
              ? lockoutService.toRaidSaveInfo(matchingLockout, content.totalBossCount)
              : null;
          },
        });
  const boosterApproved =
    signup.participationType !== "BOOSTER" || signup.offeredRoles.length === 0 || !character
      ? signup.participationType !== "BOOSTER"
      : boosterQualificationService.isApprovedFor(
          character.boosterQualifications,
          run.difficulty,
        );
  // Characterless Lootbuddy has no Character row — "active" is vacuously true.
  // Legacy Character-backed Lootbuddy still respects Character.isActive.
  const characterActive =
    signup.participationType === "LOOTBUDDY" && !character ? true : Boolean(character?.isActive);
  let issue: string | null = null;
  if (signup.status === "WITHDRAWN") issue = "Withdrawn";
  else if (!characterActive) issue = "Character is inactive.";
  else if (signup.participationType === "BOOSTER" && !boosterApproved) {
    const roleLabel =
      signup.offeredRoles.length > 0 ? formatOfferedRoles(signup.offeredRoles).toLowerCase() : "role";
    issue = `${DIFFICULTY_LABELS[run.difficulty]} ${roleLabel} access is no longer approved`;
  }

  return {
    ...signup,
    characterActive,
    boosterApproved,
    contentSaves,
    issue,
  };
}

/**
 * Composition and draft validation count the Raid Lead's draft assignment
 * (`selectedRole`) — never the volunteered `offeredRoles`, which would
 * double-count a hybrid across two buckets. Published projections use
 * `publishedRole` instead (see getPublishedRosterView).
 */
function asMember(row: InspectedSignup) {
  return {
    signupId: row.id,
    userId: row.userId,
    userName: row.userName,
    characterName: participationLabel(row),
    participationType: row.participationType,
    selectedRole: row.selectedRole,
    status: row.status,
    characterActive: row.characterActive,
    boosterApproved: row.boosterApproved,
  };
}

/** Maps a draft-selected signup into the pure Class Buff Checker participant shape. */
function normalizeExternalBoosterInput(input: ExternalBoosterInput): ExternalBoosterInput {
  const error = externalBoosterInputError(input);
  if (error) throw new DomainError("INVALID_ROSTER_SELECTION", error);
  return { name: normalizeExternalBoosterName(input.name), wowClass: input.wowClass, role: input.role };
}

function externalBoosterRaidBuffParticipant(booster: ExternalBooster): RaidBuffParticipant {
  return {
    signupId: `external:${booster.id}`,
    userName: booster.name,
    participationType: "BOOSTER",
    lootbuddyMode: null,
    wowClass: booster.wowClass,
    characterName: booster.name,
  };
}

function asRaidBuffParticipant(row: InspectedSignup): RaidBuffParticipant {
  return {
    signupId: row.id,
    userName: row.userName,
    participationType: row.participationType,
    lootbuddyMode: row.lootbuddyMode,
    wowClass: resolveBuffContributorClass({
      participationType: row.participationType,
      lootbuddyMode: row.lootbuddyMode,
      lootbuddyClass: row.lootbuddyClass,
      characterWowClass: row.character?.wowClass ?? null,
    }),
    characterName: row.character?.name ?? null,
  };
}

/**
 * Roster orchestration. Draft selection is persisted on RunRosterEntry and is
 * not RunSignup.status. Publish copies the draft into SELECTED / NOT_SELECTED
 * and snapshots each BOOSTER's draft selectedRole onto RunSignup.publishedRole
 * in one transaction. Replacement-draft edits never mutate publishedRole until
 * Publish runs again.
 */
export const rosterService = {
  async listManagedRuns(user: AuthenticatedUser) {
    const runs = await runRepository.listManaged();
    return runs.filter((run) => canManageRun(user, run)).map((run) => ({
      id: run.id,
      title: run.title,
      productLabel: run.contentDisplay.productLabel,
      contentSummary: run.contentDisplay.summary,
      difficulty: run.difficulty,
      scheduledStartAt: run.scheduledStartAt,
      status: run.status,
      raidLeadId: run.raidLeadId,
      raidLeadName: run.raidLeadName,
      signupsOpen: run.signupsOpen,
      signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
      signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
      selectedCount: run.signups.filter((signup) => signup.status === "SELECTED").length,
      draftSelectedCount: run.roster?.draftSelectedCount ?? 0,
      publishedAt: run.roster?.publishedAt ?? null,
      desiredTankCount: run.desiredTankCount,
      desiredHealerCount: run.desiredHealerCount,
      desiredDpsCount: run.desiredDpsCount,
      actionLabel: rosterActionLabel(
        run.status,
        Boolean(run.roster),
        run.roster?.publishedAt ?? null,
        run.roster?.draftSelectedCount ?? 0,
      ),
    }));
  },

  /**
   * Participant-safe published roster. Uses live SELECTED signup rows and their
   * publishedRole snapshot — never mutable draft selection.
   * Does not call ensure(), so a USER view cannot create a roster row.
   */
  async getPublishedRosterView(runId: string) {
    const roster = await rosterRepository.findByRunId(runId);
    if (!roster?.publishedAt) {
      return null;
    }

    const signups = await rosterRepository.listSignups(runId);
    const members = signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => {
        const wowClass = resolvedLootbuddyClass(signup);
        return {
          signupId: signup.id,
          userName: signup.userName,
          characterName: signup.character?.name ?? (wowClass ? CLASS_LABELS[wowClass] : "Unknown character"),
          characterRealm: signup.character?.realm ?? "",
          wowClass,
          selectedRole: signup.publishedRole,
          participationType: signup.participationType,
          isBackup: signup.isBackup,
        };
      });

    return {
      publishedAt: roster.publishedAt,
      publishedByName: roster.publishedByName,
      members,
    };
  },

  async getRosterManagementView(user: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);

    const roster = await rosterRepository.ensure(runId);
    const signups = await rosterRepository.listSignups(runId);
    const boosterCharacters = signups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.character)
      .map((signup) => ({
        id: signup.character!.id,
        name: signup.character!.name,
        region: signup.character!.region,
      }));
    const scheduleConflictsByCharacter = await getScheduleConflictsForCharacters({
      targetRunId: run.id,
      scheduledStartAt: run.scheduledStartAt,
      difficulty: run.difficulty,
      characters: boosterCharacters,
    });
    const runCommitmentsByCharacter = await getRunCommitmentsForCharacters({
      characterIds: boosterCharacters.map((character) => character.id),
      excludeRunId: run.id,
    });

    const wclBySignup = await resolveRosterWclPerformance({
      difficulty: run.difficulty,
      contents: run.contents,
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
    });

    const inspected = signups.map((signup) => ({
      ...inspectSignup(signup, run),
      draftSelected: roster.selectedSignupIds.includes(signup.id),
      scheduleConflicts:
        signup.participationType === "BOOSTER" && signup.character
          ? (scheduleConflictsByCharacter.get(signup.character.id) ?? [])
          : [],
      runCommitments:
        signup.participationType === "BOOSTER" && signup.character
          ? (runCommitmentsByCharacter.get(signup.character.id) ?? [])
          : [],
      wclPerformance: wclBySignup.get(signup.id) ?? [],
    }));

    // Draft slots whose signup was withdrawn must not count for composition or
    // Class Buffs (UI also hides WITHDRAWN candidates). Entry cleanup on withdraw
    // is best-effort; this filter is the authoritative projection guard.
    const selected = inspected.filter(
      (item) => item.draftSelected && item.status !== "WITHDRAWN",
    );
    const validation = validateRosterDraft({
      runStatus: run.status,
      selected: selected.map(asMember),
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
      },
      externalBoosters: roster.externalBoosters,
    });
    const composition = validation.composition;
    const raidBuffCoverage: RaidBuffCoverage = evaluateRaidBuffCoverage([
      ...selected.map(asRaidBuffParticipant),
      ...roster.externalBoosters.map(externalBoosterRaidBuffParticipant),
    ]);
    const canEdit = EDITABLE_RUN_STATUSES.includes(run.status);
    const publishedSelection = inspected.filter((item) => item.status === "SELECTED");
    // WITHDRAWN is a dead end (no outgoing transition) and must never appear as a
    // candidate. NOT_SELECTED stays here deliberately: a raid lead re-editing a
    // published roster can still re-select someone who wasn't picked last time.
    const candidates = inspected.filter((item) => item.status !== "WITHDRAWN");

    return {
      run: {
        id: run.id,
        title: run.title,
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        difficulty: run.difficulty,
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        signupsOpen: run.signupsOpen,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
        activeSignupCount: inspected.filter((item) => item.status !== "WITHDRAWN").length,
        publishedSelectedCount: publishedSelection.length,
        backupCount: inspected.filter((item) => item.isBackup && item.status !== "WITHDRAWN").length,
        lootbuddyCount: inspected.filter((item) => item.participationType === "LOOTBUDDY" && item.status !== "WITHDRAWN").length,
      },
      roster: {
        id: roster.id,
        state: roster.state,
        version: roster.version,
        publishedAt: roster.publishedAt,
        publishedByName: roster.publishedByName,
        canEdit,
        // Version 1 + empty draft means the published selection was never copied into
        // the draft. Later empty drafts (after the raidlead deselected everyone) keep a
        // higher version so Publish remains available.
        externalBoosters: roster.externalBoosters,
        needsPublishSeed:
          Boolean(roster.publishedAt) &&
          roster.selectedSignupIds.length === 0 &&
          publishedSelection.length > 0 &&
          roster.version === 1,
      },
      composition,
      raidBuffCoverage,
      validation,
      /**
       * Canonical unique BOOSTER candidates (one card per RunSignup).
       * Role sections below are visual projections and may repeat the same id.
       */
      boosters: canonicalBoosters(candidates),
      groups: {
        tanks: boosterCardsFor(candidates, "TANK"),
        healers: boosterCardsFor(candidates, "HEALER"),
        dps: boosterCardsFor(candidates, "DPS"),
        lootbuddies: candidates
          .filter((item) => item.participationType === "LOOTBUDDY")
          .map((item): RosterSignupCard => ({ ...item, groupRole: null })),
      },
      summary: {
        tanks: composition.tanks.selected,
        healers: composition.healers.selected,
        dps: composition.dps.selected,
        lootbuddies: composition.lootbuddies,
        boosters: composition.boosterTotal,
        total: composition.total,
      },
    };
  },

  async setDraftSelection(
    user: AuthenticatedUser,
    input: {
      runId: string;
      signupId: string;
      selected: boolean;
      version: number;
      /** Omit for a single-role offer (auto-resolved) and for LOOTBUDDY. */
      selectedRole?: CharacterRole | null;
    },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);

    const signupRecord = await signupRepository.findById(input.signupId);
    if (!signupRecord) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signupRecord.run.id !== input.runId) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "That signup does not belong to this run.");
    }

    const signups = await rosterRepository.listSignups(input.runId);
    const signup = signups.find((item) => item.id === input.signupId);
    if (!signup) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signup.status === "WITHDRAWN") {
      throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
    }

    // Cross-Run Character reservation + weekly unavailability for NEW draft
    // selection only. Already-selected conflicted Characters stay selected;
    // publish revalidates. Deselecting never needs this check.
    const alreadyDraftSelected = roster.selectedSignupIds.includes(input.signupId);
    if (
      input.selected &&
      !alreadyDraftSelected &&
      signup.participationType === "BOOSTER" &&
      signup.character
    ) {
      const scheduleConflicts = await getScheduleConflictsForCharacter({
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        character: {
          id: signup.character.id,
          name: signup.character.name,
          region: signup.character.region,
        },
      });
      assertCharacterSelectableForSchedule(
        `${signup.character.name}-${signup.character.realm}`,
        scheduleConflicts,
      );
    }

    /**
     * A User holds at most one selected BOOSTER participation per run —
     * selecting a second Booster offer replaces the previous draft row
     * instead of stacking two slots. LOOTBUDDY entries are independently
     * selectable and never replace each other or the User's Booster row (a
     * User may simultaneously have Booster participation and any number of
     * selected Lootbuddy entries) — see docs/features/signups.md.
     */
    const replaceSignupIds =
      input.selected && signup.participationType === "BOOSTER"
        ? signups
            .filter((item) => item.userId === signup.userId && item.participationType === "BOOSTER")
            .map((item) => item.id)
        : [];

    await rosterRepository.setSignupSelected({
      rosterId: roster.id,
      expectedVersion: input.version,
      signupId: input.signupId,
      selected: input.selected,
      selectedRole: input.selected ? resolveSelectedRole(signup, input.selectedRole) : null,
      replaceSignupIds,
      characterId: signup.participationType === "BOOSTER" ? (signup.character?.id ?? null) : null,
      targetRunId: input.runId,
      scheduledStartAt: run.scheduledStartAt,
    });

    if (run.status === "OPEN") {
      assertRunTransition("OPEN", "ROSTERING");
      await runRepository.updateStatus(run.id, "ROSTERING");
      await activityRepository.create({
        userId: user.id,
        type: "ROSTERING_STARTED",
        message: `Started rostering ${run.title}.`,
      });
    }
  },

  /**
   * Persist a complete draft selection in one mutation. Each selection names
   * the role the Raid Lead is assigning that slot — the decision that drives
   * composition, publish, attendance, and payout. A BOOSTER slot must resolve
   * to exactly one of its offered roles (a single-role offer resolves itself);
   * a LOOTBUDDY slot must carry none. Validates every requested signup before
   * writing; rejects malformed same-user Booster batches instead of silently
   * normalizing. OPEN → ROSTERING only when the saved selection is non-empty.
   */
  /**
   * External Boosters dialog (Run header): saves the roster's full external
   * booster set on its own, without touching the signup draft. Allowed while
   * the roster is editable; after Start use Replace on the Attendance tab.
   */
  async saveExternalBoosters(
    user: AuthenticatedUser,
    input: { runId: string; version: number; externalBoosters: ExternalBoosterInput[] },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "External boosters can only be changed before the run starts.");
    }
    const externalBoosters = input.externalBoosters.map(normalizeExternalBoosterInput);
    if (externalBoosters.length > EXTERNAL_BOOSTERS_MAX_PER_ROSTER) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `A roster can have at most ${EXTERNAL_BOOSTERS_MAX_PER_ROSTER} external boosters.`,
      );
    }
    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.replaceExternalBoosters(roster.id, input.version, externalBoosters);
  },

  async saveDraftSelection(
    user: AuthenticatedUser,
    input: {
      runId: string;
      version: number;
      selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
      /**
       * Full set of hand-added external boosters for this roster. Omitted by
       * older clients — the saved ones are then left untouched.
       */
      externalBoosters?: ExternalBoosterInput[];
    },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);

    const requested = new Map<string, CharacterRole | null>();
    for (const selection of input.selections) {
      const existing = requested.get(selection.signupId);
      if (requested.has(selection.signupId) && existing !== selection.selectedRole) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          "The same signup was selected twice with different roles.",
        );
      }
      requested.set(selection.signupId, selection.selectedRole);
    }

    const externalBoosters = input.externalBoosters?.map(normalizeExternalBoosterInput);
    if (externalBoosters && externalBoosters.length > EXTERNAL_BOOSTERS_MAX_PER_ROSTER) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `A roster can have at most ${EXTERNAL_BOOSTERS_MAX_PER_ROSTER} external boosters.`,
      );
    }

    const selectedIds = [...requested.keys()];
    const signups = await rosterRepository.listSignups(input.runId);
    const byId = new Map(signups.map((item) => [item.id, item]));
    const selectedRows: RosterSignupRow[] = [];
    const selections: RosterSelection[] = [];

    for (const signupId of selectedIds) {
      const signup = byId.get(signupId);
      if (!signup) {
        const record = await signupRepository.findById(signupId);
        if (!record) {
          throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
        }
        if (record.run.id !== input.runId) {
          throw new DomainError("INVALID_ROSTER_SELECTION", "That signup does not belong to this run.");
        }
        throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
      }
      if (signup.status === "WITHDRAWN") {
        throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
      }

      const inspected = inspectSignup(signup, run);
      if (!inspected.characterActive) {
        throw new DomainError("INVALID_ROSTER_SELECTION", inspected.issue ?? "Character is inactive.");
      }
      if (signup.participationType === "BOOSTER" && !inspected.boosterApproved) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          inspected.issue ?? "Booster access is no longer approved.",
        );
      }
      selectedRows.push(signup);
      selections.push({
        signupId,
        selectedRole: resolveSelectedRole(signup, requested.get(signupId)),
      });
    }

    const boosterByUser = new Map<string, string>();
    for (const signup of selectedRows) {
      if (signup.participationType !== "BOOSTER") continue;
      const prior = boosterByUser.get(signup.userId);
      if (prior && prior !== signup.id) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          "A user can have at most one selected booster offer. Remove the duplicate before saving.",
        );
      }
      boosterByUser.set(signup.userId, signup.id);
    }

    const previouslySelected = new Set(roster.selectedSignupIds);
    const newlySelectedCharacters = selectedRows
      .filter(
        (item) =>
          item.participationType === "BOOSTER" &&
          item.character &&
          !previouslySelected.has(item.id),
      )
      .map((item) => ({
        id: item.character!.id,
        name: item.character!.name,
        region: item.character!.region,
      }));
    if (newlySelectedCharacters.length > 0) {
      const conflictsByCharacter = await getScheduleConflictsForCharacters({
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        characters: newlySelectedCharacters,
      });
      for (const signup of selectedRows) {
        if (
          signup.participationType !== "BOOSTER" ||
          !signup.character ||
          previouslySelected.has(signup.id)
        ) {
          continue;
        }
        assertCharacterSelectableForSchedule(
          `${signup.character.name}-${signup.character.realm}`,
          conflictsByCharacter.get(signup.character.id) ?? [],
        );
      }
    }

    await rosterRepository.replaceSelectedSignupIds(roster.id, input.version, selections, {
      targetRunId: input.runId,
      scheduledStartAt: run.scheduledStartAt,
      // Repository race-check only newly added Characters (already-selected stay).
      selectedCharacterIds: newlySelectedCharacters.map((row) => row.id),
      // Save Roster already DMs players; Publish later only DMs what changed since.
      notify: { runId: input.runId, runTitle: run.title },
      externalBoosters,
    });

    if (run.status === "OPEN" && selectedIds.length > 0) {
      assertRunTransition("OPEN", "ROSTERING");
      await runRepository.updateStatus(run.id, "ROSTERING");
      await activityRepository.create({
        userId: user.id,
        type: "ROSTERING_STARTED",
        message: `Started rostering ${run.title}.`,
      });
    }
  },

  async preparePublishedRosterForEditing(user: AuthenticatedUser, input: { runId: string; version: number }) {
    const view = await this.getRosterManagementView(user, input.runId);
    if (view.run.status !== "PUBLISHED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "Only a published roster can be prepared for replacement editing.");
    }
    if (view.roster.version !== input.version) {
      throw new DomainError("ROSTER_ALREADY_CHANGED", "This roster changed since you loaded it. Refresh and try again.");
    }
    const draft = await rosterRepository.findByRunIdFromId(view.roster.id);
    if (draft.selectedSignupIds.length > 0) {
      return;
    }
    const signups = await rosterRepository.listSignups(input.runId);
    // Seeds the replacement draft from the live published selection and its
    // publishedRole snapshot — never from a previously mutated draft role.
    // A published slot predating assigned roles falls back only when the offer
    // has exactly one volunteered role.
    const selections: RosterSelection[] = signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => ({
        signupId: signup.id,
        selectedRole:
          signup.participationType !== "BOOSTER"
            ? null
            : (signup.publishedRole ??
              (signup.offeredRoles.length === 1 ? signup.offeredRoles[0] : null)),
      }));
    await rosterRepository.replaceSelectedSignupIds(view.roster.id, input.version, selections);
  },

  async validateDraft(user: AuthenticatedUser, runId: string): Promise<RosterValidationResult> {
    const view = await this.getRosterManagementView(user, runId);
    return view.validation;
  },

  async publishRoster(
    user: AuthenticatedUser,
    input: { runId: string; version: number; acknowledgeWarnings: boolean },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (run.status === "IN_PROGRESS" || run.status === "COMPLETED" || run.status === "CANCELLED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);

    const signups = await rosterRepository.listSignups(input.runId);
    const inspected = signups.map((signup) => ({
      ...inspectSignup(signup, run),
      draftSelected: roster.selectedSignupIds.includes(signup.id),
      scheduleConflicts: [] as CharacterScheduleConflict[],
      runCommitments: [] as CharacterRunCommitment[],
      wclPerformance: [],
    }));
    const selected = inspected.filter(
      (item) => item.draftSelected && item.status !== "WITHDRAWN",
    );
    const validation = validateRosterDraft({
      runStatus: run.status,
      selected: selected.map(asMember),
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
      },
      externalBoosters: roster.externalBoosters,
    });

    if (!validation.canPublish) {
      throw new DomainError(
        "ROSTER_VALIDATION_FAILED",
        validation.blockers[0]?.message ?? "This roster cannot be published.",
      );
    }
    if (validation.warnings.length > 0 && !input.acknowledgeWarnings) {
      throw new DomainError(
        "ROSTER_VALIDATION_FAILED",
        "Acknowledge composition warnings before publishing.",
      );
    }

    const selectedIds = selected.map((item) => item.id);

    // Cross-Run Character reservation + weekly unavailability for every selected
    // BOOSTER at publish time. Existing draft selection is preserved even when
    // conflicted — publish is the hard stop.
    const selectedCharacters = selected
      .filter((item) => item.participationType === "BOOSTER" && item.character)
      .map((item) => ({
        id: item.character!.id,
        name: item.character!.name,
        region: item.character!.region,
      }));
    if (selectedCharacters.length > 0) {
      const conflictsByCharacter = await getScheduleConflictsForCharacters({
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        characters: selectedCharacters,
      });
      const conflicted = selected
        .filter((item) => item.participationType === "BOOSTER" && item.character)
        .map((item) => ({
          characterId: item.character!.id,
          characterLabel: `${item.character!.name}-${item.character!.realm}`,
          conflicts: conflictsByCharacter.get(item.character!.id) ?? [],
        }))
        .filter((row) => row.conflicts.length > 0);
      assertRosterPublishableForSchedule(conflicted);
    }

    const publishedSelection = inspected.filter((item) => item.status === "SELECTED");
    if (
      roster.publishedAt &&
      selectedIds.length === 0 &&
      publishedSelection.length > 0 &&
      roster.version === 1
    ) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "Seed the draft from the published roster before publishing a replacement.",
      );
    }
    const notSelectedIds = inspected
      .filter((item) => item.status !== "WITHDRAWN" && !item.draftSelected)
      .map((item) => item.id);

    for (const item of selected) {
      if (item.status !== "SELECTED" && item.status !== "WITHDRAWN") {
        assertSignupTransition(item.status, "SELECTED");
      }
    }
    for (const item of inspected) {
      if (item.status !== "WITHDRAWN" && !item.draftSelected && item.status !== "NOT_SELECTED") {
        assertSignupTransition(item.status, "NOT_SELECTED");
      }
    }

    let nextStatus: RunStatus = run.status;
    if (run.status === "OPEN") {
      assertRunTransition("OPEN", "ROSTERING");
      assertRunTransition("ROSTERING", "PUBLISHED");
      nextStatus = "PUBLISHED";
    } else if (run.status === "ROSTERING") {
      assertRunTransition("ROSTERING", "PUBLISHED");
      nextStatus = "PUBLISHED";
    }

    const selectedSelections = selected.map((item) => ({
      signupId: item.id,
      // LOOTBUDDY slots publish with null publishedRole; BOOSTER slots carry
      // the draft assignment (already validated by resolveSelectedRole / validateRosterDraft).
      selectedRole: item.participationType === "BOOSTER" ? item.selectedRole : null,
    }));

    await rosterRepository.publishAtomic({
      runId: run.id,
      rosterId: roster.id,
      expectedVersion: input.version,
      selectedSelections,
      selectedCharacterIds: selectedCharacters.map((row) => row.id),
      scheduledStartAt: run.scheduledStartAt,
      notSelectedSignupIds: notSelectedIds,
      fromStatus: run.status,
      runStatus: nextStatus,
      publisherId: user.id,
      runTitle: run.title,
    });

    return validation;
  },
};

export type { RosterIssue };
export type RosterManagementView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
export type RosterSignupView = RosterManagementView["groups"]["tanks"][number];
export type { ParticipationType, CharacterRole, SignupStatus };
