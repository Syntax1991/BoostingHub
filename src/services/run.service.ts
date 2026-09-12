import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertCanManageRun,
  canManageRun,
  hasAdminAccess,
  hasRaidLeadAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { buildRunTitle } from "@/lib/run-title";
import { UPCOMING_RUN_STATUSES, type RaidDifficulty, type RunLootType, type RunStatus } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";
import { attendanceService } from "@/services/attendance.service";
import {
  assertValidPlannedBossCount,
  assertValidRunLootType,
  canArchiveRun,
  emptyRunCapabilities,
  getRunLifecycleCapabilities,
  isSignupWindowOpen,
  RUN_COMPOSITION_MAX,
  RUN_COMPOSITION_MIN,
  RUN_SCHEDULE_PAST_GRACE_MS,
  type RunLifecycleCapabilities,
} from "@/services/run-state";
import { rosterActionLabel } from "@/lib/run-routes";
import type { CreateRunInput, UpdateRunInput } from "@/validators/run";
import type { ManageRunFilterInput } from "@/validators/manage-run-filters";

const DISCOVERY_HIDDEN_STATUSES: readonly RunStatus[] = ["DRAFT", "CANCELLED"];

function requireManagerRole(user: AuthenticatedUser): void {
  if (!hasRaidLeadAccess(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Raid lead or admin permission is required to manage runs.", 403);
  }
}

function parseSchedule(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new DomainError("RUN_SCHEDULE_INVALID", "Enter a valid scheduled start.");
  }
  return new Date(time).toISOString();
}

function assertNewRunSchedule(iso: string): void {
  if (Date.parse(iso) < Date.now() - RUN_SCHEDULE_PAST_GRACE_MS) {
    throw new DomainError("RUN_SCHEDULE_INVALID", "Scheduled start cannot be in the past.");
  }
}

function notesValue(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function assertComposition(count: number, label: string): void {
  if (!Number.isInteger(count) || count < RUN_COMPOSITION_MIN || count > RUN_COMPOSITION_MAX) {
    throw new DomainError("VALIDATION_FAILED", `${label} must be a whole number between ${RUN_COMPOSITION_MIN} and ${RUN_COMPOSITION_MAX}.`);
  }
}

/** New-selection boundary: creating a Run may only target an available raid. */
async function requireRaidAvailableForNewSelection(raidId: string) {
  const raid = await raidRepository.findById(raidId);
  if (!raid) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
  }
  if (!raid.availableForRuns) {
    throw new DomainError(
      "RAID_NOT_AVAILABLE_FOR_RUNS",
      "This raid is no longer available for new runs.",
    );
  }
  return raid;
}

/**
 * Update boundary: only rejects on availability when the Run's raid is
 * actually changing to a different one. Keeping an existing historical
 * reference (raidId unchanged, or only difficulty changing on the same raid)
 * is never blocked by availability — only *selecting* a different raid is.
 */
async function resolveRaidForUpdate(input: { raidId: string; raidChanged: boolean }) {
  const raid = await raidRepository.findById(input.raidId);
  if (!raid) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
  }
  if (input.raidChanged && !raid.availableForRuns) {
    throw new DomainError(
      "RAID_NOT_AVAILABLE_FOR_RUNS",
      "This raid is no longer available for new runs.",
    );
  }
  return raid;
}

async function requireEligibleRaidLead(raidLeadId: string) {
  const lead = await userRepository.findById(raidLeadId);
  if (!lead || !isEligibleRaidLead(lead)) {
    throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
  }
  return lead;
}

async function loadManagedRun(user: AuthenticatedUser, runId: string) {
  const run = await runRepository.findById(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  assertCanManageRun(user, run);
  return run;
}

function capabilitiesFor(
  user: AuthenticatedUser,
  run: { status: RunStatus; signupsOpen: boolean; raidLeadId: string; archivedAt?: string | null },
  hasSignupHistory: boolean,
): RunLifecycleCapabilities {
  if (!canManageRun(user, run)) {
    return emptyRunCapabilities();
  }
  return getRunLifecycleCapabilities({
    status: run.status,
    signupsOpen: run.signupsOpen,
    hasSignupHistory,
    actorIsAdmin: hasAdminAccess(user.accountRole),
    archivedAt: run.archivedAt,
  });
}

export const runService = {
  async listRuns(
    user: AuthenticatedUser,
    filters: { difficulty?: RaidDifficulty; status?: RunStatus } = {},
  ) {
    const runs = await runRepository.listUpcoming(filters);
    const visible = runs.filter((run) => {
      if (DISCOVERY_HIDDEN_STATUSES.includes(run.status)) {
        return false;
      }
      if (run.archivedAt) {
        return false;
      }
      if (!filters.status && !UPCOMING_RUN_STATUSES.includes(run.status)) {
        return false;
      }
      return true;
    });

    return visible.map((run) => {
      const userSignups = run.signups.filter((signup) => signup.userId === user.id);
      const signedCharacters = userSignups
        .filter((signup) => signup.status !== "WITHDRAWN")
        .map((signup) => ({
          id: signup.id,
          status: signup.status,
          participationType: signup.participationType,
          isBackup: signup.isBackup,
        }));

      return {
        id: run.id,
        title: run.title,
        raidName: run.raidName,
        season: run.season,
        difficulty: run.difficulty,
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
        plannedBossCount: run.plannedBossCount,
        totalBossCount: run.totalBossCount,
        signupsOpen: run.signupsOpen,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
        selectedCount: run.signups.filter((signup) => signup.status === "SELECTED").length,
        alreadySigned: signedCharacters.length > 0,
        currentUserSignups: signedCharacters,
        ownSignupCount: signedCharacters.length,
      };
    });
  },

  async getManagedRunsPage(user: AuthenticatedUser, filters: ManageRunFilterInput = {}) {
    requireManagerRole(user);
    const now = Date.now();
    const archiveFilter = filters.archived ?? "active";
    const runs = await runRepository.listManaged();
    const managed = runs.filter((run) => canManageRun(user, run)).filter((run) => {
      if (filters.status && run.status !== filters.status) {
        return false;
      }
      if (filters.raidLeadId && run.raidLeadId !== filters.raidLeadId) {
        return false;
      }
      const start = Date.parse(run.scheduledStartAt);
      if (filters.timeframe === "upcoming" && start < now) {
        return false;
      }
      if (filters.timeframe === "past" && start >= now) {
        return false;
      }
      const isArchived = Boolean(run.archivedAt);
      if (archiveFilter === "active" && isArchived) {
        return false;
      }
      if (archiveFilter === "archived" && !isArchived) {
        return false;
      }
      return true;
    });

    const raidLeads =
      hasAdminAccess(user.accountRole) ? await userRepository.listEligibleRaidLeads() : [];

    return {
      canCreate: true,
      filters: { ...filters, archived: archiveFilter },
      raidLeads,
      runs: managed.map((run) => ({
        id: run.id,
        title: run.title,
        raidName: run.raidName,
        difficulty: run.difficulty,
        lootType: run.lootType,
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
        plannedBossCount: run.plannedBossCount,
        totalBossCount: run.totalBossCount,
        archivedAt: run.archivedAt,
        actionLabel: rosterActionLabel(
          run.status,
          Boolean(run.roster),
          run.roster?.publishedAt ?? null,
          run.roster?.draftSelectedCount ?? 0,
        ),
        capabilities: capabilitiesFor(user, run, run.signups.length > 0),
      })),
    };
  },

  async getCreateForm(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const raids = await raidRepository.listAvailableForRuns();
    const raidLeads = hasAdminAccess(user.accountRole)
      ? await userRepository.listEligibleRaidLeads()
      : [{ id: user.id, name: user.name, accountRole: user.accountRole }];
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000);
    scheduled.setUTCMinutes(0, 0, 0);
    const scheduledStartAt = scheduled.toISOString();

    return {
      actorRole: user.accountRole,
      canAssignRaidLead: hasAdminAccess(user.accountRole),
      defaultRaidLeadId: hasAdminAccess(user.accountRole) ? (raidLeads[0]?.id ?? "") : user.id,
      defaultRaidLeadName: user.name,
      raids,
      raidLeads,
      defaults: {
        difficulty: "HEROIC" as RaidDifficulty,
        // Never SAVED or VIP — UNSAVED is the only loot type valid for every
        // difficulty (including MYTHIC), so it can never need a client-side
        // override on load.
        lootType: "UNSAVED" as RunLootType,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      },
    };
  },

  async createRun(user: AuthenticatedUser, input: CreateRunInput) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const raid = await requireRaidAvailableForNewSelection(input.raidId);
    const scheduledStartAt = parseSchedule(input.scheduledStartAt);
    assertNewRunSchedule(scheduledStartAt);
    assertComposition(input.desiredTankCount, "Desired tanks");
    assertComposition(input.desiredHealerCount, "Desired healers");
    assertComposition(input.desiredDpsCount, "Desired DPS");

    const raidLeadId = hasAdminAccess(user.accountRole) ? input.raidLeadId ?? "" : user.id;
    if (hasAdminAccess(user.accountRole) && !input.raidLeadId) {
      throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
    }
    if (!hasAdminAccess(user.accountRole) && input.raidLeadId && input.raidLeadId !== user.id) {
      throw new DomainError("RUN_RAID_LEAD_INVALID", "Raid leads can only create runs they lead.");
    }
    const raidLead = await requireEligibleRaidLead(raidLeadId);

    assertValidRunLootType(input.difficulty, input.lootType);
    assertValidPlannedBossCount(input.plannedBossCount, raid.totalBossCount);

    const title = buildRunTitle({
      scheduledStartAt,
      difficulty: input.difficulty,
      lootType: input.lootType,
      plannedBossCount: input.plannedBossCount,
      totalBossCount: raid.totalBossCount,
      raidLeadName: raidLead.name,
    });

    const id = await runRepository.create({
      title,
      raidId: raid.id,
      difficulty: input.difficulty,
      lootType: input.lootType,
      scheduledStartAt,
      raidLeadId,
      notes: notesValue(input.notes),
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
      plannedBossCount: input.plannedBossCount,
    });

    await activityRepository.create({
      userId: user.id,
      type: "RUN_CREATED",
      message: "Created a run draft.",
    });

    return { id };
  },

  async updateRun(user: AuthenticatedUser, input: UpdateRunInput) {
    const run = await loadManagedRun(user, input.runId);
    const signupCount = await runRepository.countSignups(run.id);
    const hasSignupHistory = signupCount > 0;
    const capabilities = capabilitiesFor(user, run, hasSignupHistory);

    if (!capabilities.canEdit) {
      throw new DomainError("RUN_EDIT_LOCKED", "This run can no longer be edited.");
    }

    const scheduledStartAt = parseSchedule(input.scheduledStartAt);
    assertComposition(input.desiredTankCount, "Desired tanks");
    assertComposition(input.desiredHealerCount, "Desired healers");
    assertComposition(input.desiredDpsCount, "Desired DPS");
    const nextNotes = notesValue(input.notes);
    const identityChanged = input.raidId !== run.raidId || input.difficulty !== run.difficulty;
    const leadChanged = Boolean(input.raidLeadId && input.raidLeadId !== run.raidLeadId);

    if (identityChanged && !capabilities.canEditIdentity) {
      throw new DomainError(
        "RUN_IDENTITY_LOCKED",
        hasSignupHistory
          ? "Raid and difficulty cannot change after a signup has been recorded."
          : "Raid and difficulty cannot be changed in this run state.",
      );
    }

    if (!capabilities.canEditPlanning) {
      const planningChanged =
        scheduledStartAt !== run.scheduledStartAt ||
        nextNotes !== run.notes ||
        input.lootType !== run.lootType ||
        input.plannedBossCount !== run.plannedBossCount ||
        input.desiredTankCount !== run.desiredTankCount ||
        input.desiredHealerCount !== run.desiredHealerCount ||
        input.desiredDpsCount !== run.desiredDpsCount;
      if (planningChanged) {
        throw new DomainError("RUN_EDIT_LOCKED", "Planning fields cannot be edited in this run state.");
      }
    }

    let raidLeadId = run.raidLeadId;
    let raidLeadName = run.raidLeadName;
    if (leadChanged) {
      if (!capabilities.canReassignRaidLead) {
        throw new DomainError("RUN_RAID_LEAD_INVALID", "You cannot reassign the raid lead for this run.");
      }
      const lead = await requireEligibleRaidLead(input.raidLeadId!);
      raidLeadId = input.raidLeadId!;
      raidLeadName = lead.name;
    }

    let raidId = run.raidId;
    let difficulty = run.difficulty;
    let totalBossCount = run.totalBossCount;
    if (identityChanged) {
      // Only actually selecting a different raid is gated by availability —
      // a difficulty-only change that keeps the same (possibly historical)
      // raid must not be blocked merely because that raid isn't a new-Run
      // option anymore.
      const raidChanged = input.raidId !== run.raidId;
      const raid = await resolveRaidForUpdate({ raidId: input.raidId, raidChanged });
      raidId = raid.id;
      difficulty = input.difficulty;
      totalBossCount = raid.totalBossCount;
    }

    assertValidRunLootType(difficulty, input.lootType);
    assertValidPlannedBossCount(input.plannedBossCount, totalBossCount);

    // Server is always the sole title authority — recomputed from the final
    // normalized values on every update, including notes/composition-only
    // changes (recomputation is deterministic and cheap; no need to detect
    // whether the title's own source fields actually changed).
    const title = buildRunTitle({
      scheduledStartAt,
      difficulty,
      lootType: input.lootType,
      plannedBossCount: input.plannedBossCount,
      totalBossCount,
      raidLeadName,
    });

    const fields = {
      title,
      lootType: input.lootType,
      scheduledStartAt,
      raidLeadId,
      notes: nextNotes,
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
      plannedBossCount: input.plannedBossCount,
    };

    if (identityChanged) {
      await runRepository.updateIdentityIfNoSignupHistory(run.id, {
        ...fields,
        raidId,
        difficulty,
      });
    } else {
      await runRepository.updateFields(run.id, fields);
    }

    await activityRepository.create({
      userId: user.id,
      type: "RUN_UPDATED",
      message: "Updated run planning.",
    });

    return { id: run.id };
  },

  async openRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (run.status === "OPEN") {
      throw new DomainError("RUN_ALREADY_OPEN", "This run is already open.");
    }
    if (run.status !== "DRAFT") {
      throw new DomainError("RUN_INVALID_TRANSITION", "Only a draft run can be opened.");
    }
    // Opening progresses the Run's already-established raid reference — it
    // is not a new raid selection, so raid availability is never re-checked
    // here (a Draft created before a raid became historical must still be
    // openable).

    await runRepository.updateFields(run.id, { status: "OPEN", signupsOpen: true });
    await activityRepository.create({
      userId: user.id,
      type: "RUN_OPENED",
      message: "Opened a run for signups.",
    });
    return { id: run.id };
  },

  async setSignupWindow(user: AuthenticatedUser, runId: string, open: boolean) {
    const run = await loadManagedRun(user, runId);
    if (run.status === "DRAFT") {
      throw new DomainError("RUN_INVALID_TRANSITION", "Open the run before changing the signup window.");
    }
    if (run.status !== "OPEN" && run.status !== "ROSTERING") {
      throw new DomainError("RUN_INVALID_TRANSITION", "The signup window cannot be changed in this run state.");
    }
    if (open && run.signupsOpen) {
      throw new DomainError("RUN_SIGNUPS_ALREADY_OPEN", "Signups are already open.");
    }
    if (!open && !run.signupsOpen) {
      throw new DomainError("RUN_SIGNUPS_ALREADY_CLOSED", "Signups are already closed.");
    }

    await runRepository.updateFields(run.id, { signupsOpen: open });
    await activityRepository.create({
      userId: user.id,
      type: open ? "RUN_SIGNUPS_REOPENED" : "RUN_SIGNUPS_CLOSED",
      message: open ? "Reopened the signup window." : "Closed the signup window.",
    });
    return { id: run.id };
  },

  async cancelRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (!getRunLifecycleCapabilities({
      status: run.status,
      signupsOpen: run.signupsOpen,
      hasSignupHistory: false,
      actorIsAdmin: hasAdminAccess(user.accountRole),
    }).canCancel) {
      throw new DomainError("RUN_CANNOT_CANCEL", "This run cannot be cancelled.");
    }

    await runRepository.updateFields(run.id, { status: "CANCELLED", signupsOpen: false });
    await activityRepository.create({
      userId: user.id,
      type: "RUN_CANCELLED",
      message: "Cancelled a run.",
    });
    return { id: run.id };
  },

  async startRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (run.status === "IN_PROGRESS") {
      throw new DomainError("RUN_ALREADY_STARTED", "This run has already started.");
    }
    if (run.status !== "PUBLISHED") {
      throw new DomainError("RUN_NOT_PUBLISHED", "Only a published run can be started.");
    }
    const selectedSignupIds = await attendanceService.listPublishedSelectedSignupIds(run.id);
    if (selectedSignupIds.length === 0) {
      throw new DomainError(
        "RUN_CANNOT_START",
        "A published roster with at least one selected participant is required.",
      );
    }

    await attendanceService.snapshotSelectedRoster(run.id);
    await activityRepository.create({
      userId: user.id,
      type: "RUN_STARTED",
      message: "Started a run.",
    });
    return { id: run.id };
  },

  async completeRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (run.status === "COMPLETED") {
      throw new DomainError("RUN_CANNOT_COMPLETE", "This run is already completed.");
    }
    if (run.status !== "IN_PROGRESS") {
      throw new DomainError("RUN_CANNOT_COMPLETE", "Only an in-progress run can be completed.");
    }

    await attendanceService.completeIfFullyMarked(run.id);
    await activityRepository.create({
      userId: user.id,
      type: "RUN_COMPLETED",
      message: "Completed a run.",
    });
    return { id: run.id };
  },

  /**
   * Archive is administrative visibility, never a RunStatus — status and every
   * historical relation (signups, roster, strikes, attendance, payout, Discord
   * state) are left completely untouched.
   */
  async archiveRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (run.archivedAt) {
      throw new DomainError("RUN_ALREADY_ARCHIVED", "This run is already archived.");
    }
    if (!canArchiveRun(run.status, run.archivedAt)) {
      throw new DomainError("RUN_CANNOT_ARCHIVE", "Only a completed or cancelled run can be archived.");
    }

    await runRepository.archiveRun(run.id, user.id);
    await activityRepository.create({
      userId: user.id,
      type: "RUN_ARCHIVED",
      message: `Archived ${run.title}.`,
    });
    return { id: run.id };
  },

  async restoreRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (!run.archivedAt) {
      throw new DomainError("RUN_NOT_ARCHIVED", "This run is not archived.");
    }

    await runRepository.restoreRun(run.id);
    await activityRepository.create({
      userId: user.id,
      type: "RUN_RESTORED",
      message: `Restored ${run.title}.`,
    });
    return { id: run.id };
  },

  /**
   * Permanent deletion. ADMIN-only, and only for an empty Draft — a Draft with
   * any real relation history (signups, roster, strikes, attendance, payout,
   * Discord state) must be cancelled/archived instead. Never relies on a bare
   * FK failure: every blocker is checked explicitly first.
   */
  async deleteRun(user: AuthenticatedUser, runId: string) {
    if (!hasAdminAccess(user.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to delete a run.", 403);
    }
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (run.status !== "DRAFT") {
      throw new DomainError("RUN_CANNOT_DELETE", "Only a draft run can be deleted.");
    }

    const blockers = await runRepository.getDeleteBlockers(run.id);
    if (blockers.length > 0) {
      throw new DomainError(
        "RUN_CANNOT_DELETE",
        "Runs with signup or operational history cannot be deleted. Cancel/archive this run instead.",
      );
    }

    await runRepository.deleteRun(run.id);
    await activityRepository.create({
      userId: user.id,
      type: "RUN_DELETED",
      message: `Deleted an unused draft run: ${run.title}.`,
    });
    return { id: run.id };
  },
};

export type ManagedRunsPage = Awaited<ReturnType<typeof runService.getManagedRunsPage>>;
export type CreateRunForm = Awaited<ReturnType<typeof runService.getCreateForm>>;
