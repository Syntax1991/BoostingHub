import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertCanManageRun,
  canManageRun,
  hasAdminAccess,
  hasRaidLeadAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { UPCOMING_RUN_STATUSES, type RaidDifficulty, type RunStatus } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";
import {
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

function defaultTitle(raidName: string, difficulty: RaidDifficulty): string {
  return `${raidName} ${DIFFICULTY_LABELS[difficulty]}`;
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

async function requireActiveRaid(raidId: string) {
  const raid = await raidRepository.findById(raidId);
  if (!raid || !raid.isActive) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
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

function capabilitiesFor(user: AuthenticatedUser, run: { status: RunStatus; signupsOpen: boolean; raidLeadId: string }, hasSignupHistory: boolean): RunLifecycleCapabilities {
  if (!canManageRun(user, run)) {
    return emptyRunCapabilities();
  }
  return getRunLifecycleCapabilities({
    status: run.status,
    signupsOpen: run.signupsOpen,
    hasSignupHistory,
    actorIsAdmin: hasAdminAccess(user.accountRole),
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
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
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
      return true;
    });

    const raidLeads =
      hasAdminAccess(user.accountRole) ? await userRepository.listEligibleRaidLeads() : [];

    return {
      canCreate: true,
      filters,
      raidLeads,
      runs: managed.map((run) => ({
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
      })),
    };
  },

  async getCreateForm(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const raids = await raidRepository.listActive();
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
    const raid = await requireActiveRaid(input.raidId);
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
    await requireEligibleRaidLead(raidLeadId);

    const title = input.title?.trim() || defaultTitle(raid.name, input.difficulty);
    const id = await runRepository.create({
      title,
      raidId: raid.id,
      difficulty: input.difficulty,
      scheduledStartAt,
      raidLeadId,
      notes: notesValue(input.notes),
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
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
    const nextTitle = input.title.trim();
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
        nextTitle !== run.title ||
        scheduledStartAt !== run.scheduledStartAt ||
        nextNotes !== run.notes ||
        input.desiredTankCount !== run.desiredTankCount ||
        input.desiredHealerCount !== run.desiredHealerCount ||
        input.desiredDpsCount !== run.desiredDpsCount;
      if (planningChanged) {
        throw new DomainError("RUN_EDIT_LOCKED", "Planning fields cannot be edited in this run state.");
      }
    }

    let raidLeadId = run.raidLeadId;
    if (leadChanged) {
      if (!capabilities.canReassignRaidLead) {
        throw new DomainError("RUN_RAID_LEAD_INVALID", "You cannot reassign the raid lead for this run.");
      }
      await requireEligibleRaidLead(input.raidLeadId!);
      raidLeadId = input.raidLeadId!;
    }

    let raidId = run.raidId;
    let difficulty = run.difficulty;
    if (identityChanged) {
      const raid = await requireActiveRaid(input.raidId);
      raidId = raid.id;
      difficulty = input.difficulty;
    }

    const fields = {
      title: nextTitle,
      scheduledStartAt,
      raidLeadId,
      notes: nextNotes,
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
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
    await requireActiveRaid(run.raidId);

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
};

export type ManagedRunsPage = Awaited<ReturnType<typeof runService.getManagedRunsPage>>;
export type CreateRunForm = Awaited<ReturnType<typeof runService.getCreateForm>>;
