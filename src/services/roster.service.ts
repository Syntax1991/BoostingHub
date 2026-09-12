import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun, canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { resetIdentifierFor } from "@/lib/datetime";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { lockoutService } from "@/services/lockout.service";
import { assertRunTransition, isSignupWindowOpen } from "@/services/run-state";
import { assertSignupTransition } from "@/services/signup-state";
import { validateRosterDraft, type RosterIssue, type RosterValidationResult } from "@/services/roster-validation";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { activityRepository } from "@/repositories/activity.repository";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { rosterActionLabel } from "@/lib/run-routes";
import type { CharacterRole, ParticipationType, RaidDifficulty, RunStatus, SignupStatus } from "@/models/enums";

const EDITABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

type InspectedSignup = RosterSignupRow & {
  draftSelected: boolean;
  characterActive: boolean;
  boosterApproved: boolean;
  lockoutConflict: boolean;
  issue: string | null;
};

function inspectSignup(
  signup: RosterSignupRow,
  run: { raidId: string; difficulty: RaidDifficulty },
  resetIdentifier: string,
): Omit<InspectedSignup, "draftSelected"> {
  const character = signup.character;
  const lockoutConflict = character
    ? lockoutService.hasRunConflict(character.lockouts, {
        raidId: run.raidId,
        difficulty: run.difficulty,
        resetIdentifier,
      })
    : false;
  const boosterApproved =
    signup.participationType !== "BOOSTER" || !signup.role || !character
      ? signup.participationType !== "BOOSTER"
      : boosterQualificationService.isApprovedFor(
          character.boosterQualifications,
          run.difficulty,
        );
  const characterActive = character?.isActive ?? false;
  let issue: string | null = null;
  if (signup.status === "WITHDRAWN") issue = "Withdrawn";
  else if (!characterActive) issue = "Character is inactive.";
  else if (lockoutConflict) issue = `Locked for this ${DIFFICULTY_LABELS[run.difficulty]} reset`;
  else if (signup.participationType === "BOOSTER" && !boosterApproved) {
    const roleLabel = signup.role ? CHARACTER_ROLE_LABELS[signup.role].toLowerCase() : "role";
    issue = `${DIFFICULTY_LABELS[run.difficulty]} ${roleLabel} access is no longer approved`;
  }

  return {
    ...signup,
    characterActive,
    boosterApproved,
    lockoutConflict,
    issue,
  };
}

function asMember(row: InspectedSignup) {
  return {
    signupId: row.id,
    userId: row.userId,
    userName: row.userName,
    characterName: row.character?.name ?? "Unknown character",
    participationType: row.participationType,
    role: row.role,
    status: row.status,
    characterActive: row.characterActive,
    boosterApproved: row.boosterApproved,
    lockoutConflict: row.lockoutConflict,
  };
}

/**
 * Roster orchestration. Draft selection is persisted on RunRosterEntry and is
 * not RunSignup.status. Publish copies the draft into SELECTED / NOT_SELECTED
 * in one transaction and re-checks BoosterAccess plus lockouts because those
 * can change after signup.
 */
export const rosterService = {
  async listManagedRuns(user: AuthenticatedUser) {
    const runs = await runRepository.listManaged();
    return runs.filter((run) => canManageRun(user, run)).map((run) => ({
      id: run.id,
      title: run.title,
      raidName: run.raidName,
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
   * Participant-safe published roster. Uses live SELECTED signup rows, never draft
   * selection. Does not call ensure(), so a USER view cannot create a roster row.
   */
  async getPublishedRosterView(runId: string) {
    const roster = await rosterRepository.findByRunId(runId);
    if (!roster?.publishedAt) {
      return null;
    }

    const signups = await rosterRepository.listSignups(runId);
    const members = signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => ({
        signupId: signup.id,
        userName: signup.userName,
        characterName: signup.character?.name ?? "Unknown character",
        characterRealm: signup.character?.realm ?? "",
        wowClass: signup.character?.wowClass ?? null,
        role: signup.role,
        participationType: signup.participationType,
        isBackup: signup.isBackup,
      }));

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
    const resetIdentifier = resetIdentifierFor(run.scheduledStartAt);
    const inspected = signups.map((signup) => ({
      ...inspectSignup(signup, run, resetIdentifier),
      draftSelected: roster.selectedSignupIds.includes(signup.id),
    }));

    const selected = inspected.filter((item) => item.draftSelected);
    const validation = validateRosterDraft({
      runStatus: run.status,
      selected: selected.map(asMember),
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
      },
    });
    const composition = validation.composition;
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
        raidName: run.raidName,
        difficulty: run.difficulty,
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
        needsPublishSeed:
          Boolean(roster.publishedAt) &&
          roster.selectedSignupIds.length === 0 &&
          publishedSelection.length > 0 &&
          roster.version === 1,
      },
      composition,
      validation,
      groups: {
        tanks: candidates.filter((item) => item.participationType === "BOOSTER" && item.role === "TANK"),
        healers: candidates.filter((item) => item.participationType === "BOOSTER" && item.role === "HEALER"),
        dps: candidates.filter((item) => item.participationType === "BOOSTER" && item.role === "DPS"),
        lootbuddies: candidates.filter((item) => item.participationType === "LOOTBUDDY"),
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
    input: { runId: string; signupId: string; selected: boolean; version: number },
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

    // Cross-Run Character reservation, BOOSTER only (see the LOOTBUDDY audit
    // note in signup.service.ts). Deselecting never needs this check — that
    // is exactly how a reservation is released for another colliding Run.
    if (input.selected && signup.participationType === "BOOSTER" && signup.character) {
      const conflicts = await signupRepository.findReservationConflicts({
        characterIds: [signup.character.id],
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
      });
      if (conflicts.length > 0) {
        throw new DomainError(
          "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
          `${signup.character.name} is already selected for ${conflicts[0].runTitle}.`,
        );
      }
    }

    /**
     * One selected participation per user per run. Selecting a second offer
     * replaces the previous draft row instead of stacking two slots.
     */
    const replaceSignupIds = input.selected
      ? signups.filter((item) => item.userId === signup.userId).map((item) => item.id)
      : [];

    await rosterRepository.setSignupSelected({
      rosterId: roster.id,
      expectedVersion: input.version,
      signupId: input.signupId,
      selected: input.selected,
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

  async preparePublishedRosterForEditing(user: AuthenticatedUser, input: { runId: string; version: number }) {
    const view = await this.getRosterManagementView(user, input.runId);
    if (view.run.status !== "PUBLISHED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "Only a published roster can be prepared for replacement editing.");
    }
    if (view.roster.version !== input.version) {
      throw new DomainError("ROSTER_ALREADY_CHANGED", "This roster changed since you loaded it. Refresh and try again.");
    }
    if (view.groups.tanks.concat(view.groups.healers, view.groups.dps, view.groups.lootbuddies).some((item) => item.draftSelected)) {
      return;
    }
    const selectedIds = view.groups.tanks
      .concat(view.groups.healers, view.groups.dps, view.groups.lootbuddies)
      .filter((item) => item.status === "SELECTED")
      .map((item) => item.id);
    await rosterRepository.replaceSelectedSignupIds(view.roster.id, input.version, selectedIds);
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
    const resetIdentifier = resetIdentifierFor(run.scheduledStartAt);
    const inspected = signups.map((signup) => ({
      ...inspectSignup(signup, run, resetIdentifier),
      draftSelected: roster.selectedSignupIds.includes(signup.id),
    }));
    const selected = inspected.filter((item) => item.draftSelected);
    const validation = validateRosterDraft({
      runStatus: run.status,
      selected: selected.map(asMember),
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
      },
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

    // Cross-Run Character reservation, BOOSTER only (see the LOOTBUDDY audit
    // note in signup.service.ts). Booster access and lockouts are already
    // re-checked above via inspectSignup for the same reason: eligibility
    // can drift between signup time and publish time.
    const selectedCharacterIds = selected
      .filter((item) => item.participationType === "BOOSTER")
      .map((item) => item.character?.id)
      .filter((id): id is string => Boolean(id));
    if (selectedCharacterIds.length > 0) {
      const conflicts = await signupRepository.findReservationConflicts({
        characterIds: selectedCharacterIds,
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
      });
      if (conflicts.length > 0) {
        const conflict = conflicts[0];
        const conflictingName = selected.find((item) => item.character?.id === conflict.characterId)?.character?.name;
        throw new DomainError(
          "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
          `${conflictingName ?? "A selected character"} is already selected for ${conflict.runTitle}. Resolve the conflict before publishing.`,
        );
      }
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

    await rosterRepository.publishAtomic({
      runId: run.id,
      rosterId: roster.id,
      expectedVersion: input.version,
      selectedSignupIds: selectedIds,
      selectedCharacterIds,
      scheduledStartAt: run.scheduledStartAt,
      notSelectedSignupIds: notSelectedIds,
      fromStatus: run.status,
      runStatus: nextStatus,
      publisherId: user.id,
    });

    return validation;
  },
};

export type { RosterIssue };
export type RosterManagementView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
export type RosterSignupView = RosterManagementView["groups"]["tanks"][number];
export type { ParticipationType, CharacterRole, SignupStatus };
