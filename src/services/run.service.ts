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
import {
  expandRunContentPreset,
  listCreateRunContentPresets,
  projectRunContentDisplay,
  type ExpandedRunContent,
  type RunContentPresetKey,
} from "@/lib/run-content-presets";
import { TIDEBOUND_GROTTO_RAID_ID } from "@/lib/wow-raid-catalog";
import { UPCOMING_RUN_STATUSES, type RaidDifficulty, type RunLootType, type RunStatus } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository, type RunCreateWithContentsInput } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";
import { attendanceService } from "@/services/attendance.service";
import { discordSyncService } from "@/services/discord-sync.service";
import {
  runCancelledChannelSourceKey,
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runLifecycleNotificationService } from "@/services/run-lifecycle-notifications.service";
import { runTemplateService } from "@/services/run-template.service";
import {
  assertComposition,
  assertValidPlannedBossCount,
  assertValidRunLootType,
  canArchiveRun,
  emptyRunCapabilities,
  getRunLifecycleCapabilities,
  isSignupWindowOpen,
  notesValue,
  RUN_SCHEDULE_PAST_GRACE_MS,
  type RunLifecycleCapabilities,
} from "@/services/run-state";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { CreateRunInput, StartRunInput, UpdateRunInput } from "@/validators/run";
import type { ManageRunFilterInput } from "@/validators/manage-run-filters";
import type { CreateManyRunsInput, MassCreateDefaults, MassCreateRunRow } from "@/validators/mass-create-runs";
import type { RaidRecord } from "@/repositories/raid.repository";
import { isDomainError } from "@/lib/errors";
import { projectManagedRunHandoffs } from "@/services/managed-run-operational.service";

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

/**
 * Resolve every Raid referenced by expanded contents. Tidebound may be
 * selected as a fixed Bundle companion even when availableForRuns=false;
 * every other raid must be available for new product selection.
 */
async function resolveRaidsForContents(contents: ExpandedRunContent[]): Promise<Map<string, RaidRecord>> {
  const raidIds = [...new Set(contents.map((row) => row.raidId))];
  const raids = await raidRepository.listByIds(raidIds);
  const byId = new Map(raids.map((raid) => [raid.id, raid]));

  for (const content of contents) {
    const raid = byId.get(content.raidId);
    if (!raid) {
      throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
    }
    if (!raid.availableForRuns && content.raidId !== TIDEBOUND_GROTTO_RAID_ID) {
      throw new DomainError(
        "RAID_NOT_AVAILABLE_FOR_RUNS",
        "This raid is no longer available for new runs.",
      );
    }
    assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
  }

  return byId;
}

function expandPresetOrThrow(input: {
  contentPreset: RunContentPresetKey;
  venomousPlannedBossCount: number;
}): ExpandedRunContent[] {
  try {
    return expandRunContentPreset({
      preset: input.contentPreset,
      venomousPlannedBossCount: input.venomousPlannedBossCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid run content preset.";
    if (message.toLowerCase().includes("planned boss count")) {
      throw new DomainError("RUN_BOSS_COUNT_INVALID", message);
    }
    throw new DomainError("VALIDATION_FAILED", message);
  }
}

async function requireEligibleRaidLead(raidLeadId: string) {
  const lead = await userRepository.findById(raidLeadId);
  if (!lead || !isEligibleRaidLead(lead)) {
    throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
  }
  return lead;
}

/**
 * Decides which raidLeadId a new Run should target — before any DB lookup.
 * RAID_LEAD may only ever target themselves (a forged different id is
 * rejected); ADMIN must explicitly choose someone. Shared by single create
 * and every row of mass create so a forged raidLeadId is rejected identically
 * either way.
 */
function resolveRequestedRaidLeadId(user: AuthenticatedUser, requestedRaidLeadId: string | undefined): string {
  if (hasAdminAccess(user.accountRole)) {
    if (!requestedRaidLeadId) {
      throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
    }
    return requestedRaidLeadId;
  }
  if (requestedRaidLeadId && requestedRaidLeadId !== user.id) {
    throw new DomainError("RUN_RAID_LEAD_INVALID", "Raid leads can only create runs they lead.");
  }
  return user.id;
}

/**
 * One Run's fully-merged, not-yet-validated planning input — for single
 * create this is just the request body; for mass create this is
 * `defaults + row.overrides` merged by `mergeMassCreateRow` below.
 */
type EffectiveRunInput = {
  contentPreset?: RunContentPresetKey;
  venomousPlannedBossCount?: number;
  /** Legacy singular create — expanded to one content row when preset absent. */
  raidId?: string;
  plannedBossCount?: number;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  raidLeadId?: string;
  notes?: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  /** When true, first Discord channel provision pings Tank/Healer/DPS roles. Default true. */
  discordRolePing?: boolean;
};

type PreparedRunDraft = RunCreateWithContentsInput;

function expandEffectiveContents(input: EffectiveRunInput): ExpandedRunContent[] {
  if (input.contentPreset) {
    return expandPresetOrThrow({
      contentPreset: input.contentPreset,
      venomousPlannedBossCount: input.venomousPlannedBossCount ?? 8,
    });
  }
  if (!input.raidId || input.plannedBossCount == null) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported run product.");
  }
  return [
    {
      raidId: input.raidId,
      sortOrder: 1,
      plannedBossCount: input.plannedBossCount,
    },
  ];
}

/**
 * The single normalized preparation path for a new Run draft: schedule
 * normalization/past-date rule, composition bounds, loot-type/difficulty
 * compatibility, expanded contents vs raid totals, notes normalization, and
 * server title derivation from content coverage tokens.
 */
function prepareRunDraft(
  input: EffectiveRunInput,
  context: {
    contents: ExpandedRunContent[];
    raidById: Map<string, RaidRecord>;
    raidLeadId: string;
    raidLeadName: string;
  },
): PreparedRunDraft {
  const scheduledStartAt = parseSchedule(input.scheduledStartAt);
  assertNewRunSchedule(scheduledStartAt);
  assertComposition(input.desiredTankCount, "Desired tanks");
  assertComposition(input.desiredHealerCount, "Desired healers");
  assertComposition(input.desiredDpsCount, "Desired DPS");
  assertValidRunLootType(input.difficulty, input.lootType);

  if (context.contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run must include at least one raid content row.");
  }

  for (const content of context.contents) {
    const raid = context.raidById.get(content.raidId);
    if (!raid) {
      throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
    }
    assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
  }

  const displayRows = context.contents.map((content) => {
    const raid = context.raidById.get(content.raidId)!;
    return {
      raidId: content.raidId,
      raidName: raid.name,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      totalBossCount: raid.totalBossCount,
    };
  });
  const display = projectRunContentDisplay(displayRows);

  const title = buildRunTitle({
    scheduledStartAt,
    difficulty: input.difficulty,
    lootType: input.lootType,
    titleCoverage: display.titleCoverage,
    raidLeadName: context.raidLeadName,
  });

  return {
    title,
    difficulty: input.difficulty,
    lootType: input.lootType,
    scheduledStartAt,
    raidLeadId: context.raidLeadId,
    notes: notesValue(input.notes),
    desiredTankCount: input.desiredTankCount,
    desiredHealerCount: input.desiredHealerCount,
    desiredDpsCount: input.desiredDpsCount,
    discordRolePing: input.discordRolePing ?? true,
    contents: context.contents,
  };
}

/**
 * Merges shared defaults with one row's overrides into an effective input.
 * Supports commercial preset defaults and legacy raidId defaults.
 */
function mergeMassCreateRow(defaults: MassCreateDefaults, row: MassCreateRunRow): EffectiveRunInput {
  const overrides = (row.overrides ?? {}) as Record<string, unknown>;
  const base = defaults as Record<string, unknown>;

  const contentPreset =
    (overrides.contentPreset as RunContentPresetKey | undefined) ??
    (base.contentPreset as RunContentPresetKey | undefined);
  const venomousPlannedBossCount =
    (overrides.venomousPlannedBossCount as number | undefined) ??
    (base.venomousPlannedBossCount as number | undefined);
  const raidId = (overrides.raidId as string | undefined) ?? (base.raidId as string | undefined);
  const plannedBossCount =
    (overrides.plannedBossCount as number | undefined) ?? (base.plannedBossCount as number | undefined);

  return {
    contentPreset,
    venomousPlannedBossCount,
    raidId,
    plannedBossCount,
    difficulty: (overrides.difficulty as RaidDifficulty | undefined) ?? (base.difficulty as RaidDifficulty),
    lootType: (overrides.lootType as RunLootType | undefined) ?? (base.lootType as RunLootType),
    scheduledStartAt: row.scheduledStartAt,
    raidLeadId: (overrides.raidLeadId as string | undefined) ?? (base.raidLeadId as string | undefined),
    notes: overrides.notes === undefined ? (base.notes as string | null | undefined) : (overrides.notes as string | null),
    desiredTankCount:
      (overrides.desiredTankCount as number | undefined) ?? (base.desiredTankCount as number),
    desiredHealerCount:
      (overrides.desiredHealerCount as number | undefined) ?? (base.desiredHealerCount as number),
    desiredDpsCount: (overrides.desiredDpsCount as number | undefined) ?? (base.desiredDpsCount as number),
    discordRolePing:
      (overrides.discordRolePing as boolean | undefined) ??
      (base.discordRolePing as boolean | undefined) ??
      true,
  };
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
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        titleCoverage: run.contentDisplay.titleCoverage,
        difficulty: run.difficulty,
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
        contents: run.contents,
        contentDisplay: run.contentDisplay,
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

    const projected = await projectManagedRunHandoffs(user, managed);

    const raidLeads =
      hasAdminAccess(user.accountRole) ? await userRepository.listEligibleRaidLeads() : [];

    return {
      canCreate: true,
      filters: { ...filters, archived: archiveFilter },
      raidLeads,
      runs: projected.map(({ run, handoff, capabilities }) => ({
        id: run.id,
        title: run.title,
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        titleCoverage: run.contentDisplay.titleCoverage,
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
        contents: run.contents,
        contentDisplay: run.contentDisplay,
        archivedAt: run.archivedAt,
        actionLabel: handoff.nextAction.label,
        attendance: handoff.attendance,
        settlementStage: handoff.settlement.stage,
        attention: handoff.attention,
        nextAction: handoff.nextAction,
        capabilities,
      })),
    };
  },

  async getCreateForm(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const contentPresets = listCreateRunContentPresets();
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
      contentPresets,
      venomousBossMax: 8,
      raidLeads,
      defaults: {
        contentPreset: "VENOMOUS_ABYSS" as RunContentPresetKey,
        venomousPlannedBossCount: 8,
        difficulty: "HEROIC" as RaidDifficulty,
        // Never SAVED or VIP — UNSAVED is the only loot type valid for every
        // difficulty (including MYTHIC), so it can never need a client-side
        // override on load.
        lootType: "UNSAVED" as RunLootType,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        discordRolePing: true,
      },
    };
  },

  async createRun(user: AuthenticatedUser, input: CreateRunInput) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const effective: EffectiveRunInput = { ...input };
    const contents = expandEffectiveContents(effective);
    const raidById = await resolveRaidsForContents(contents);
    const raidLeadId = resolveRequestedRaidLeadId(user, input.raidLeadId);
    const raidLead = await requireEligibleRaidLead(raidLeadId);

    const draft = prepareRunDraft(effective, {
      contents,
      raidById,
      raidLeadId,
      raidLeadName: raidLead.name,
    });
    const id = await runRepository.create(draft);

    await activityRepository.create({
      userId: user.id,
      type: "RUN_CREATED",
      message: "Created a run draft.",
    });

    return { id };
  },

  async getCreateManyForm(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const contentPresets = listCreateRunContentPresets();
    const raidLeads = hasAdminAccess(user.accountRole)
      ? await userRepository.listEligibleRaidLeads()
      : [{ id: user.id, name: user.name, accountRole: user.accountRole }];
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000);
    scheduled.setUTCMinutes(0, 0, 0);
    const scheduledStartAt = scheduled.toISOString();

    const usableTemplates = await runTemplateService.listUsableForCreation(user);
    const templates = usableTemplates.map((template) => ({
      id: template.id,
      raidLeadId: template.raidLeadId,
      // Templates remain Venomous-shaped; Bundle is selected via contentPreset.
      contentPreset: "VENOMOUS_ABYSS" as RunContentPresetKey,
      venomousPlannedBossCount: Math.min(8, Math.max(1, template.plannedBossCount)),
      difficulty: template.difficulty,
      lootType: template.lootType,
      desiredTankCount: template.desiredTankCount,
      desiredHealerCount: template.desiredHealerCount,
      desiredDpsCount: template.desiredDpsCount,
      notes: template.notes,
      label: `${template.raidLeadName} — ${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} ${template.plannedBossCount}/${template.totalBossCount}`,
    }));

    return {
      actorRole: user.accountRole,
      canAssignRaidLead: hasAdminAccess(user.accountRole),
      defaultRaidLeadId: hasAdminAccess(user.accountRole) ? (raidLeads[0]?.id ?? "") : user.id,
      defaultRaidLeadName: user.name,
      contentPresets,
      venomousBossMax: 8,
      raidLeads,
      templates,
      maxRuns: 25,
      defaults: {
        contentPreset: "VENOMOUS_ABYSS" as RunContentPresetKey,
        venomousPlannedBossCount: 8,
        difficulty: "HEROIC" as RaidDifficulty,
        lootType: "UNSAVED" as RunLootType,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        discordRolePing: true,
      },
    };
  },

  /**
   * Mass Create Runs: shared defaults + per-row overrides -> N atomic DRAFT
   * Runs (all-or-nothing). Every row is fully prepared and validated — via
   * the exact same `prepareRunDraft`/`resolveRequestedRaidLeadId` single
   * create uses — before any persistence is attempted.
   *
   * When `input.templateId` is present, the template is resolved and
   * authorized fresh from the DB (never trusting the browser's copy) BEFORE
   * any row is prepared, and its raidLeadId becomes authoritative for every
   * row — a defaults- or row-level raidLeadId that explicitly disagrees with
   * it rejects the entire batch rather than being silently overridden.
   */
  async createManyRuns(user: AuthenticatedUser, input: CreateManyRunsInput): Promise<{ ids: string[] }> {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();

    let templateRaidLeadId: string | undefined;
    if (input.templateId) {
      const template = await runTemplateService.resolveTemplateForUse(user, input.templateId);
      templateRaidLeadId = template.raidLeadId;

      if (input.defaults.raidLeadId && input.defaults.raidLeadId !== templateRaidLeadId) {
        throw new DomainError(
          "RUN_TEMPLATE_RAID_LEAD_MISMATCH",
          "The selected template's raid lead cannot be overridden.",
        );
      }
      input.runs.forEach((row, index) => {
        const overrideRaidLeadId = row.overrides?.raidLeadId;
        if (overrideRaidLeadId && overrideRaidLeadId !== templateRaidLeadId) {
          throw new DomainError(
            "RUN_TEMPLATE_RAID_LEAD_MISMATCH",
            `Run ${index + 1}: the selected template's raid lead cannot be overridden.`,
          );
        }
      });
    }

    const effectiveRows = input.runs.map((row) => mergeMassCreateRow(input.defaults, row));
    if (templateRaidLeadId) {
      for (const row of effectiveRows) {
        row.raidLeadId = templateRaidLeadId;
      }
    }

    const expandedByRow = effectiveRows.map((row) => expandEffectiveContents(row));
    const allRaidIds = [...new Set(expandedByRow.flatMap((contents) => contents.map((c) => c.raidId)))];
    const raidById = new Map(
      (await raidRepository.listByIds(allRaidIds)).map((raid) => [raid.id, raid]),
    );

    const eligibleLeads = await userRepository.listEligibleRaidLeads();
    const leadById = new Map(eligibleLeads.map((lead) => [lead.id, lead]));

    const prepared: PreparedRunDraft[] = [];
    for (let index = 0; index < effectiveRows.length; index += 1) {
      const effective = effectiveRows[index]!;
      const contents = expandedByRow[index]!;
      try {
        for (const content of contents) {
          const raid = raidById.get(content.raidId);
          if (!raid) {
            throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
          }
          if (!raid.availableForRuns && content.raidId !== TIDEBOUND_GROTTO_RAID_ID) {
            throw new DomainError(
              "RAID_NOT_AVAILABLE_FOR_RUNS",
              "This raid is no longer available for new runs.",
            );
          }
        }

        const raidLeadId = resolveRequestedRaidLeadId(user, effective.raidLeadId);
        const raidLead = leadById.get(raidLeadId);
        if (!raidLead) {
          throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
        }

        prepared.push(
          prepareRunDraft(effective, {
            contents,
            raidById,
            raidLeadId,
            raidLeadName: raidLead.name,
          }),
        );
      } catch (error) {
        if (isDomainError(error)) {
          throw new DomainError(error.code, `Run ${index + 1}: ${error.message}`, error.status);
        }
        throw error;
      }
    }

    const ids = await runRepository.createManyDraftsAtomic(prepared);

    await activityRepository.create({
      userId: user.id,
      type: "RUN_CREATED",
      message: `Created ${ids.length} run draft${ids.length === 1 ? "" : "s"} via mass create.`,
    });

    return { ids };
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

    const currentContents = await runRepository.listRaidContents(run.id);
    if (currentContents.length === 0) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "This run is missing raid content rows and cannot be edited until repaired.",
      );
    }

    let nextContents: ExpandedRunContent[];
    let contentChanged: boolean;

    if ("contentPreset" in input) {
      nextContents = expandPresetOrThrow({
        contentPreset: input.contentPreset,
        venomousPlannedBossCount: input.venomousPlannedBossCount,
      });
      const orderedCurrent = [...currentContents].sort((a, b) => a.sortOrder - b.sortOrder);
      contentChanged =
        orderedCurrent.length !== nextContents.length ||
        nextContents.some((next, index) => {
          const cur = orderedCurrent[index];
          return !cur || cur.raidId !== next.raidId || cur.plannedBossCount !== next.plannedBossCount;
        });
    } else {
      // Historical / CUSTOM singular path — replace with one content row only when
      // the content identity or planned count actually changes.
      const orderedCurrent = [...currentContents].sort((a, b) => a.sortOrder - b.sortOrder);
      contentChanged =
        orderedCurrent.length !== 1 ||
        orderedCurrent[0]!.raidId !== input.raidId ||
        orderedCurrent[0]!.plannedBossCount !== input.plannedBossCount;
      nextContents = contentChanged
        ? [{ raidId: input.raidId, sortOrder: 1, plannedBossCount: input.plannedBossCount }]
        : orderedCurrent.map((row) => ({
            raidId: row.raidId,
            sortOrder: row.sortOrder,
            plannedBossCount: row.plannedBossCount,
          }));
    }

    const identityChanged = contentChanged || input.difficulty !== run.difficulty;
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
        input.desiredTankCount !== run.desiredTankCount ||
        input.desiredHealerCount !== run.desiredHealerCount ||
        input.desiredDpsCount !== run.desiredDpsCount ||
        (input.discordRolePing ?? run.discordRolePing) !== run.discordRolePing;
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

    let difficulty = run.difficulty;
    if (identityChanged) {
      difficulty = input.difficulty;
      // Availability is only re-checked when content composition changes — a
      // difficulty-only edit on a historical Run must keep its existing raids.
      if (contentChanged) {
        await resolveRaidsForContents(nextContents);
      }
    }

    const raidById = new Map(
      (await raidRepository.listByIds([...new Set(nextContents.map((row) => row.raidId))])).map(
        (raid) => [raid.id, raid],
      ),
    );
    for (const content of nextContents) {
      const raid = raidById.get(content.raidId);
      if (!raid) {
        throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
      }
      assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
    }
    assertValidRunLootType(difficulty, input.lootType);

    const display = projectRunContentDisplay(
      nextContents.map((content) => {
        const raid = raidById.get(content.raidId)!;
        return {
          raidId: content.raidId,
          raidName: raid.name,
          sortOrder: content.sortOrder,
          plannedBossCount: content.plannedBossCount,
          totalBossCount: raid.totalBossCount,
        };
      }),
    );

    const title = buildRunTitle({
      scheduledStartAt,
      difficulty,
      lootType: input.lootType,
      titleCoverage: display.titleCoverage,
      raidLeadName,
    });

    const scheduleChanged =
      Date.parse(scheduledStartAt) !== Date.parse(run.scheduledStartAt);
    const nextScheduleRevision = scheduleChanged ? run.scheduleRevision + 1 : run.scheduleRevision;
    const previousScheduledStartAt = run.scheduledStartAt;

    const fields = {
      title,
      lootType: input.lootType,
      scheduledStartAt,
      ...(scheduleChanged ? { scheduleRevision: nextScheduleRevision } : {}),
      raidLeadId,
      notes: nextNotes,
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
      discordRolePing: input.discordRolePing ?? run.discordRolePing,
    };

    const rescheduleAnnouncement = scheduleChanged
      ? {
          runId: run.id,
          type: "RUN_RESCHEDULED" as const,
          sourceKey: runRescheduledChannelSourceKey(run.id, nextScheduleRevision),
          previousScheduledStartAt,
          scheduledStartAt,
          productLabel: display.productLabel,
          difficulty,
          lootType: input.lootType,
          status: "PENDING" as const,
        }
      : null;

    if (identityChanged) {
      await runRepository.updateIdentityIfNoSignupHistory(
        run.id,
        {
          ...fields,
          difficulty,
          contents: contentChanged ? nextContents : undefined,
        },
        rescheduleAnnouncement,
      );
    } else if (rescheduleAnnouncement) {
      await runRepository.updateFieldsWithDiscordAnnouncement(run.id, fields, rescheduleAnnouncement);
    } else {
      // Non-content updates must not rewrite RunRaidContent / Bundle rows.
      await runRepository.updateFields(run.id, fields);
    }

    if (scheduleChanged) {
      await runLifecycleNotificationService.notifyRunRescheduled({
        runId: run.id,
        productLabel: display.productLabel,
        previousScheduledStartAt,
        nextScheduledStartAt: scheduledStartAt,
        scheduleRevision: nextScheduleRevision,
        difficulty,
        lootType: input.lootType,
      });
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

    await runRepository.cancelWithDiscordAnnouncement(run.id, {
      runId: run.id,
      type: "RUN_CANCELLED",
      sourceKey: runCancelledChannelSourceKey(run.id),
      previousScheduledStartAt: null,
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel || run.title,
      difficulty: run.difficulty,
      lootType: run.lootType,
      status: "PENDING",
    });
    await runLifecycleNotificationService.notifyRunCancelled({
      runId: run.id,
      runTitle: run.title,
      scheduledStartAt: run.scheduledStartAt,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    await activityRepository.create({
      userId: user.id,
      type: "RUN_CANCELLED",
      message: "Cancelled a run.",
    });
    return { id: run.id };
  },

  async startRun(user: AuthenticatedUser, input: StartRunInput) {
    const run = await loadManagedRun(user, input.runId);
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

    await attendanceService.snapshotSelectedRoster(run.id, {
      startedById: user.id,
    });
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
    await discordSyncService.clearArchiveArtifacts(run.id);
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
export type CreateManyRunsForm = Awaited<ReturnType<typeof runService.getCreateManyForm>>;
