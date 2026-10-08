import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertCanManageRun,
  canManageRun,
  hasAdminAccess,
  hasRaidLeadAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { resolveEffectiveRunComposition } from "@/lib/run-composition";
import { buildRunTitle } from "@/lib/run-title";
import {
  projectRunContentCoverage,
  projectRunContentDisplay,
  type ExpandedRunContent,
} from "@/lib/run-content-presets";
import {
  defaultContentBossCounts,
  matchProductForContents,
  type ContentBossCounts,
  type PlanningProduct,
} from "@/lib/product-selection";
import {
  expandSelectionOrThrow,
  isSelectableProduct,
  productPlanningService,
  requireSelectableProduct,
} from "@/services/product-planning.service";
import { UPCOMING_RUN_STATUSES, type RaidDifficulty, type RunLootType, type RunStatus } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import { runRepository, type RunCreateWithContentsInput } from "@/repositories/run.repository";
import type { RunTemplateRecord } from "@/repositories/run-template.repository";
import { runStartSnapshotRepository } from "@/repositories/run-start-snapshot.repository";
import { userRepository } from "@/repositories/user.repository";
import { attendanceService } from "@/services/attendance.service";
import { discordSyncService } from "@/services/discord-sync.service";
import {
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runLifecycleNotificationService } from "@/services/run-lifecycle-notifications.service";
import { runDomainEventService } from "@/services/run-domain-event.service";
import { runTemplateService } from "@/services/run-template.service";
import {
  assertComposition,
  assertValidPlannedBossCount,
  assertValidRunLootType,
  canArchiveRun,
  canToggleSignupWindow,
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
 * Resolve every Raid referenced by contents and validate planned counts.
 *
 * Raid availability (legacy `Raid.isActive`) only gates the legacy
 * single-raid shape. Product contents are authorized by the Product itself
 * (active + selectable), so bundle-only raids need no special case; Run
 * Setup contents were authorized when the setup was saved.
 */
async function resolveRaidsForContents(
  contents: ExpandedRunContent[],
  options: { requireRaidAvailability: boolean },
): Promise<Map<string, RaidRecord>> {
  const raidIds = [...new Set(contents.map((row) => row.raidId))];
  const raids = await raidRepository.listByIds(raidIds);
  const byId = new Map(raids.map((raid) => [raid.id, raid]));

  for (const content of contents) {
    const raid = byId.get(content.raidId);
    if (!raid) {
      throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
    }
    if (options.requireRaidAvailability && !raid.availableForRuns) {
      throw new DomainError(
        "RAID_NOT_AVAILABLE_FOR_RUNS",
        "This raid is no longer available for new runs.",
      );
    }
    assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
  }

  return byId;
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
  /** Product selection (any active + selectable Product). */
  productId?: string;
  contentBossCounts?: ContentBossCounts;
  /** Legacy singular create — expanded to one content row when no product is chosen. */
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
  /** Planned Lootbuddy slots (target only). Omitted by legacy callers → 0. */
  desiredLootbuddyCount?: number;
  /** When true, first Discord channel provision pings Tank/Healer/DPS roles. Default true. */
  discordRolePing?: boolean;
};

type PreparedRunDraft = RunCreateWithContentsInput;

/**
 * Expand one Run's content: a Product selection resolves its ordered
 * ProductRaidContent rows from the DB catalog (counts validated, FIXED
 * forced); the legacy shape yields one row. `viaProduct` decides whether
 * raid availability applies.
 */
function expandEffectiveContents(
  input: EffectiveRunInput,
  products: readonly PlanningProduct[],
): { contents: ExpandedRunContent[]; viaProduct: boolean } {
  if (input.productId) {
    const product = requireSelectableProduct(products, input.productId);
    return { contents: expandSelectionOrThrow(product, input.contentBossCounts ?? {}), viaProduct: true };
  }
  if (!input.raidId || input.plannedBossCount == null) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported run product.");
  }
  return {
    contents: [{ raidId: input.raidId, sortOrder: 1, plannedBossCount: input.plannedBossCount }],
    viaProduct: false,
  };
}

/** Selector options for every product-driven planning form: active + selectable products. */
function toProductOptions(products: readonly PlanningProduct[]): PlanningProduct[] {
  return products.filter(isSelectableProduct);
}

/** Initial product selection for a form: the first selectable product with its default counts. */
function defaultProductSelection(products: readonly PlanningProduct[]) {
  const first = products.find(isSelectableProduct);
  return {
    productId: first?.id ?? "",
    contentBossCounts: first ? defaultContentBossCounts(first) : {},
  };
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
  assertComposition(input.desiredLootbuddyCount ?? 0, "Desired lootbuddies");
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
    desiredLootbuddyCount: input.desiredLootbuddyCount ?? 0,
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

  const baseProductId = base.productId as string | undefined;
  const overrideProductId = overrides.productId as string | undefined;
  const productId = overrideProductId ?? baseProductId;
  // Counts belong to one product's content ids: shared counts only apply while
  // the row keeps the shared product.
  const contentBossCounts =
    (overrides.contentBossCounts as ContentBossCounts | undefined) ??
    (overrideProductId && overrideProductId !== baseProductId
      ? undefined
      : (base.contentBossCounts as ContentBossCounts | undefined));
  const raidId = (overrides.raidId as string | undefined) ?? (base.raidId as string | undefined);
  const plannedBossCount =
    (overrides.plannedBossCount as number | undefined) ?? (base.plannedBossCount as number | undefined);

  return {
    productId,
    contentBossCounts,
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
    desiredLootbuddyCount:
      (overrides.desiredLootbuddyCount as number | undefined) ?? (base.desiredLootbuddyCount as number | undefined) ?? 0,
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
  run: {
    status: RunStatus;
    signupsOpen: boolean;
    raidLeadId: string;
    archivedAt?: string | null;
    cancelledFromStatus?: RunStatus | null;
  },
): RunLifecycleCapabilities {
  if (!canManageRun(user, run)) {
    return emptyRunCapabilities();
  }
  return getRunLifecycleCapabilities({
    status: run.status,
    signupsOpen: run.signupsOpen,
    actorIsAdmin: hasAdminAccess(user.accountRole),
    archivedAt: run.archivedAt,
    cancelledFromStatus: run.cancelledFromStatus,
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
        desiredLootbuddyCount: run.desiredLootbuddyCount,
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
        desiredLootbuddyCount: run.desiredLootbuddyCount,
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
    const products = toProductOptions(await productPlanningService.listAll());
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
      products,
      raidLeads,
      defaults: {
        ...defaultProductSelection(products),
        difficulty: "HEROIC" as RaidDifficulty,
        // Never SAVED or VIP — UNSAVED is the only loot type valid for every
        // difficulty (including MYTHIC), so it can never need a client-side
        // override on load.
        lootType: "UNSAVED" as RunLootType,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        discordRolePing: true,
      },
    };
  },

  async createRun(user: AuthenticatedUser, input: CreateRunInput) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const effective: EffectiveRunInput = { ...input };
    const products = effective.productId ? await productPlanningService.listAll() : [];
    const { contents, viaProduct } = expandEffectiveContents(effective, products);
    const raidById = await resolveRaidsForContents(contents, { requireRaidAvailability: !viaProduct });
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
    await runDomainEventService.record({
      runId: id,
      actorUser: user,
      type: "RUN_CREATED",
      summary: "Run draft created.",
      payload: { difficulty: draft.difficulty, lootType: draft.lootType },
    });

    return { id };
  },

  async prepareDraftFromTemplate(input: {
    template: RunTemplateRecord;
    scheduledStartAt: string;
    /** Concrete Run Raid Lead — from Schedule slot or Create Run selection. */
    raidLeadId: string;
    /** Optional Schedule composition override source. */
    scheduleSlot?: {
      compositionOverrideEnabled: boolean;
      desiredTankCountOverride: number | null;
      desiredHealerCountOverride: number | null;
      desiredDpsCountOverride: number | null;
      desiredLootbuddyCountOverride: number | null;
    } | null;
  }): Promise<RunCreateWithContentsInput> {
    await raidRepository.ensureReferenceRaids();
    // Authoritative template contents (RunTemplateRaidContent) — never reduce
    // Bundle back to the singular dual-write mirror columns.
    const contents: ExpandedRunContent[] =
      input.template.contents.length > 0
        ? input.template.contents.map((row) => ({
            raidId: row.raidId,
            sortOrder: row.sortOrder,
            plannedBossCount: row.plannedBossCount,
          }))
        : [
            {
              raidId: input.template.raidId,
              sortOrder: 1,
              plannedBossCount: input.template.plannedBossCount,
            },
          ];
    const composition = resolveEffectiveRunComposition({
      template: input.template,
      scheduleSlot: input.scheduleSlot,
    });
    const effective: EffectiveRunInput = {
      difficulty: input.template.difficulty,
      lootType: input.template.lootType,
      scheduledStartAt: input.scheduledStartAt,
      raidLeadId: input.raidLeadId,
      notes: input.template.notes,
      desiredTankCount: composition.desiredTankCount,
      desiredHealerCount: composition.desiredHealerCount,
      desiredDpsCount: composition.desiredDpsCount,
      desiredLootbuddyCount: composition.desiredLootbuddyCount,
      discordRolePing: true,
    };
    const raidById = await resolveRaidsForContents(contents, { requireRaidAvailability: false });
    const raidLead = await requireEligibleRaidLead(input.raidLeadId);
    return prepareRunDraft(effective, {
      contents,
      raidById,
      raidLeadId: input.raidLeadId,
      raidLeadName: raidLead.name,
    });
  },

  async createScheduleMaterializedDraft(input: {
    template: RunTemplateRecord;
    scheduledStartAt: string;
    scheduleSlotId: string;
    windowStartAt: string;
    raidLeadId: string;
    scheduleSlot: {
      compositionOverrideEnabled: boolean;
      desiredTankCountOverride: number | null;
      desiredHealerCountOverride: number | null;
      desiredDpsCountOverride: number | null;
      desiredLootbuddyCountOverride: number | null;
    };
    actor: { kind: "USER"; user: AuthenticatedUser } | { kind: "SYSTEM" };
  }): Promise<{ runId: string; alreadyExisted: boolean }> {
    const draft = await this.prepareDraftFromTemplate({
      template: input.template,
      scheduledStartAt: input.scheduledStartAt,
      raidLeadId: input.raidLeadId,
      scheduleSlot: input.scheduleSlot,
    });

    const createdByKind = input.actor.kind;
    const createdById = input.actor.kind === "USER" ? input.actor.user.id : null;
    const materializedBy = createdByKind;

    try {
      const { runId } = await runRepository.createDraftWithScheduleLink({
        draft,
        link: {
          scheduleSlotId: input.scheduleSlotId,
          windowStartAt: input.windowStartAt,
          occurrenceStartAt: input.scheduledStartAt,
          createdById,
          createdByKind,
        },
      });

      await runDomainEventService.record({
        runId,
        type: "RUN_CREATED",
        summary: "Run draft created from community schedule.",
        actorKind: createdByKind,
        actorUser: input.actor.kind === "USER" ? input.actor.user : null,
        payload: {
          source: "COMMUNITY_SCHEDULE",
          scheduleSlotId: input.scheduleSlotId,
          scheduleWindowStartAt: input.windowStartAt,
          occurrenceStartAt: input.scheduledStartAt,
          materializedBy,
          difficulty: draft.difficulty,
          lootType: draft.lootType,
        },
      });

      if (input.actor.kind === "USER") {
        await activityRepository.create({
          userId: input.actor.user.id,
          type: "RUN_CREATED",
          message: "Created a run draft from the community schedule.",
        });
      }

      return { runId, alreadyExisted: false };
    } catch (error) {
      if (!isDomainError(error) || error.code !== "SCHEDULE_OCCURRENCE_ALREADY_CREATED") {
        throw error;
      }
      const existing = await communityScheduleRunRepository.findBySlotAndWindow(
        input.scheduleSlotId,
        input.windowStartAt,
      );
      if (!existing) {
        throw error;
      }
      return { runId: existing.runId, alreadyExisted: true };
    }
  },

  async getCreateManyForm(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const products = toProductOptions(await productPlanningService.listAll());
    const raidLeads = hasAdminAccess(user.accountRole)
      ? await userRepository.listEligibleRaidLeads()
      : [{ id: user.id, name: user.name, accountRole: user.accountRole }];
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000);
    scheduled.setUTCMinutes(0, 0, 0);
    const scheduledStartAt = scheduled.toISOString();

    const usableTemplates = await runTemplateService.listUsableForCreation(user);
    const templates = usableTemplates.map((template) => {
      const contentRows =
        template.contents.length > 0
          ? template.contents
          : [
              {
                raidId: template.raidId,
                sortOrder: 1,
                plannedBossCount: template.plannedBossCount,
                totalBossCount: template.totalBossCount,
              },
            ];
      const coverage = projectRunContentCoverage(contentRows);
      // Applying a template preselects its product while that product is still selectable.
      const selection = matchProductForContents(products, contentRows);
      return {
        id: template.id,
        productId: selection?.productId ?? null,
        contentBossCounts: selection?.contentBossCounts ?? {},
        difficulty: template.difficulty,
        lootType: template.lootType,
        desiredTankCount: template.desiredTankCount,
        desiredHealerCount: template.desiredHealerCount,
        desiredDpsCount: template.desiredDpsCount,
        desiredLootbuddyCount: template.desiredLootbuddyCount,
        notes: template.notes,
        label: `${template.name} — ${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} ${coverage.titleCoverage}`,
      };
    });

    return {
      actorRole: user.accountRole,
      canAssignRaidLead: hasAdminAccess(user.accountRole),
      defaultRaidLeadId: hasAdminAccess(user.accountRole) ? (raidLeads[0]?.id ?? "") : user.id,
      defaultRaidLeadName: user.name,
      products,
      raidLeads,
      templates,
      maxRuns: 25,
      defaults: {
        ...defaultProductSelection(products),
        difficulty: "HEROIC" as RaidDifficulty,
        lootType: "UNSAVED" as RunLootType,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
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
   * When `input.templateId` is present, the global template is resolved and
   * authorized fresh from the DB. Default composition is applied
   * server-authoritatively unless a row already overrides composition.
   * Raid Lead remains independently selected on defaults/rows.
   */
  async createManyRuns(user: AuthenticatedUser, input: CreateManyRunsInput): Promise<{ ids: string[] }> {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();

    let templateDefaults: ReturnType<typeof resolveEffectiveRunComposition> | undefined;
    if (input.templateId) {
      const template = await runTemplateService.resolveTemplateForUse(user, input.templateId);
      templateDefaults = resolveEffectiveRunComposition({ template, scheduleSlot: null });
    }

    const effectiveRows = input.runs.map((row) => {
      const merged = mergeMassCreateRow(input.defaults, row);
      if (templateDefaults) {
        const overrides = row.overrides ?? {};
        if (overrides.desiredTankCount === undefined) {
          merged.desiredTankCount = templateDefaults.desiredTankCount;
        }
        if (overrides.desiredHealerCount === undefined) {
          merged.desiredHealerCount = templateDefaults.desiredHealerCount;
        }
        if (overrides.desiredDpsCount === undefined) {
          merged.desiredDpsCount = templateDefaults.desiredDpsCount;
        }
        if (overrides.desiredLootbuddyCount === undefined) {
          merged.desiredLootbuddyCount = templateDefaults.desiredLootbuddyCount;
        }
      }
      return merged;
    });

    // One catalog read for the whole batch (no per-row / per-product queries).
    const products = effectiveRows.some((row) => row.productId) ? await productPlanningService.listAll() : [];
    const expandedByRow = effectiveRows.map((row, index) => {
      try {
        return expandEffectiveContents(row, products);
      } catch (error) {
        if (isDomainError(error)) {
          throw new DomainError(error.code, `Run ${index + 1}: ${error.message}`, error.status);
        }
        throw error;
      }
    });
    const allRaidIds = [...new Set(expandedByRow.flatMap(({ contents }) => contents.map((c) => c.raidId)))];
    const raidById = new Map(
      (await raidRepository.listByIds(allRaidIds)).map((raid) => [raid.id, raid]),
    );

    const eligibleLeads = await userRepository.listEligibleRaidLeads();
    const leadById = new Map(eligibleLeads.map((lead) => [lead.id, lead]));

    const prepared: PreparedRunDraft[] = [];
    for (let index = 0; index < effectiveRows.length; index += 1) {
      const effective = effectiveRows[index]!;
      const { contents, viaProduct } = expandedByRow[index]!;
      try {
        for (const content of contents) {
          const raid = raidById.get(content.raidId);
          if (!raid) {
            throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
          }
          if (!viaProduct && !raid.availableForRuns) {
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
    // Pre-start only (Start Run is the freeze point); signup history never
    // locks a field. The repository re-checks the status under the roster lock.
    const capabilities = capabilitiesFor(user, run);

    if (!capabilities.canEdit) {
      throw new DomainError("RUN_EDIT_LOCKED", "This run can no longer be edited — it has already started.");
    }

    const scheduledStartAt = parseSchedule(input.scheduledStartAt);
    assertComposition(input.desiredTankCount, "Desired tanks");
    assertComposition(input.desiredHealerCount, "Desired healers");
    assertComposition(input.desiredDpsCount, "Desired DPS");
    // Omitted by an older caller → the Run keeps its Lootbuddy target.
    const desiredLootbuddyCount = input.desiredLootbuddyCount ?? run.desiredLootbuddyCount;
    assertComposition(desiredLootbuddyCount, "Desired lootbuddies");
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

    let contentViaProduct = false;
    const orderedCurrentContents = [...currentContents].sort((a, b) => a.sortOrder - b.sortOrder);
    if (input.productId) {
      // New selections need an active + selectable product; keeping the Run's
      // own current product only needs it to be active.
      const products = await productPlanningService.listAll();
      const current = matchProductForContents(
        products.filter((product) => product.active),
        orderedCurrentContents,
      );
      const product =
        current?.productId === input.productId
          ? products.find((row) => row.id === input.productId)!
          : requireSelectableProduct(products, input.productId);
      nextContents = expandSelectionOrThrow(product, input.contentBossCounts ?? {});
      contentViaProduct = true;
      contentChanged =
        orderedCurrentContents.length !== nextContents.length ||
        nextContents.some((next, index) => {
          const cur = orderedCurrentContents[index];
          return !cur || cur.raidId !== next.raidId || cur.plannedBossCount !== next.plannedBossCount;
        });
    } else if (input.raidId === undefined || input.plannedBossCount === undefined) {
      // No content fields: keep the current contents exactly as they are.
      contentChanged = false;
      nextContents = orderedCurrentContents.map((row) => ({
        raidId: row.raidId,
        sortOrder: row.sortOrder,
        plannedBossCount: row.plannedBossCount,
      }));
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
        await resolveRaidsForContents(nextContents, { requireRaidAvailability: !contentViaProduct });
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
      desiredLootbuddyCount,
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

    // Roster-relevant: anything roster validation / the Discord roster embed /
    // Start depend on. A published roster then needs Update Roster before
    // Start. Notes, the role-ping flag and the Raid Lead are not roster
    // validation inputs; a Raid Lead change only alters the derived title,
    // which the current Discord roster message is refreshed for in place.
    const rosterRelevantChanged =
      identityChanged ||
      scheduleChanged ||
      input.lootType !== run.lootType ||
      input.desiredTankCount !== run.desiredTankCount ||
      input.desiredHealerCount !== run.desiredHealerCount ||
      input.desiredDpsCount !== run.desiredDpsCount ||
      desiredLootbuddyCount !== run.desiredLootbuddyCount;
    const rosterEffect = rosterRelevantChanged ? "MARK_CHANGED" : title !== run.title ? "REFRESH_EMBED" : "NONE";

    // One atomic pre-start write; content rows are replaced only when they
    // actually changed, so a planning edit never rewrites Bundle rows.
    await runRepository.updatePreStartAtomic(
      run.id,
      { ...fields, difficulty },
      {
        contents: contentChanged ? nextContents : undefined,
        announcement: rescheduleAnnouncement,
        rosterEffect,
      },
    );

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
    if (scheduleChanged) {
      await runDomainEventService.record({
        runId: run.id,
        actorUser: user,
        type: "RUN_SCHEDULE_CHANGED",
        summary: "Run schedule changed.",
        payload: {
          fromScheduledStartAt: previousScheduledStartAt,
          toScheduledStartAt: scheduledStartAt,
          scheduleRevision: nextScheduleRevision,
        },
      });
    }
    if (contentChanged || input.difficulty !== run.difficulty || input.lootType !== run.lootType) {
      await runDomainEventService.record({
        runId: run.id,
        actorUser: user,
        type: "RUN_CONTENT_CHANGED",
        summary: "Run content or difficulty changed.",
        payload: {
          contentSummary: display.summary,
          difficulty,
          lootType: input.lootType,
        },
      });
    }
    if (leadChanged) {
      await runDomainEventService.record({
        runId: run.id,
        actorUser: user,
        type: "RUN_RAID_LEAD_CHANGED",
        summary: `Raid Lead changed to ${raidLeadName}.`,
        payload: {
          fromRaidLeadId: run.raidLeadId,
          toRaidLeadId: raidLeadId,
          fromRaidLeadName: run.raidLeadName,
          toRaidLeadName: raidLeadName,
        },
      });
    }

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
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "RUN_OPENED",
      summary: "Run opened for signups.",
      payload: { fromStatus: "DRAFT", toStatus: "OPEN", signupsOpen: true },
    });
    return { id: run.id };
  },

  async setSignupWindow(user: AuthenticatedUser, runId: string, open: boolean) {
    const run = await loadManagedRun(user, runId);
    if (run.status === "DRAFT") {
      throw new DomainError("RUN_INVALID_TRANSITION", "Open the run before changing the signup window.");
    }
    if (!canToggleSignupWindow(run.status)) {
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
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: open ? "SIGNUPS_OPENED" : "SIGNUPS_CLOSED",
      summary: open ? "Signup window reopened." : "Signup window closed.",
      payload: { signupsOpen: open },
    });
    return { id: run.id };
  },

  async cancelRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (!getRunLifecycleCapabilities({
      status: run.status,
      signupsOpen: run.signupsOpen,
      actorIsAdmin: hasAdminAccess(user.accountRole),
      archivedAt: run.archivedAt,
      cancelledFromStatus: run.cancelledFromStatus,
    }).canCancel) {
      throw new DomainError("RUN_CANNOT_CANCEL", "This run cannot be cancelled.");
    }

    // Channel lifecycle announcement is authoritative and atomic with CANCELLED.
    // The repository re-reads Run state, derives cancelRevision, snapshots
    // pre-cancel fields, and skips any still-PENDING prior RUN_REACTIVATED
    // channel announcement inside the same transaction.
    // Personal UserNotifications are separate (notifyRunCancelled) and must not
    // be mixed into this transaction — bot retirement waits on RunDiscordAnnouncement
    // terminal status before transcript/archive and channel deletion.
    const { cancelRevision } = await runRepository.cancelWithDiscordAnnouncement(run.id, {
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel || run.title,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    await runLifecycleNotificationService.notifyRunCancelled({
      runId: run.id,
      cancelRevision,
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
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "RUN_CANCELLED",
      summary: "Run cancelled.",
      payload: { fromStatus: run.status, toStatus: "CANCELLED", cancelRevision },
    });
    return { id: run.id };
  },

  async reactivateRun(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (!getRunLifecycleCapabilities({
      status: run.status,
      signupsOpen: run.signupsOpen,
      actorIsAdmin: hasAdminAccess(user.accountRole),
      archivedAt: run.archivedAt,
      cancelledFromStatus: run.cancelledFromStatus,
    }).canReactivate) {
      throw new DomainError(
        "RUN_CANNOT_REACTIVATE",
        "This cancelled run cannot be reactivated.",
      );
    }

    // Hard safety: never resurrect a Run that actually started.
    // The repository rechecks under the shared roster lock — this is UX-fast.
    const [startSnapshot, attendanceCount] = await Promise.all([
      runStartSnapshotRepository.findByRunId(run.id),
      attendanceRepository.countByRunId(run.id),
    ]);
    if (startSnapshot || attendanceCount > 0 || run.completedAt) {
      throw new DomainError(
        "RUN_CANNOT_REACTIVATE",
        "A run that has started cannot be reactivated.",
      );
    }

    // Internal expected revision from this service read. The repository
    // re-validates under lock and rejects ABA (rev1 intent against rev2).
    const expectedCancelRevision = run.cancelRevision;

    await runRepository.reactivateWithDiscordAnnouncement(run.id, expectedCancelRevision, {
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel || run.title,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });

    // Historical archive pointers describe the cancelled channel's retirement,
    // not the currently active Run — clear so a later retirement can post again.
    await discordSyncService.clearArchiveArtifacts(run.id);

    await runLifecycleNotificationService.notifyRunReactivated({
      runId: run.id,
      cancelRevision: expectedCancelRevision,
      runTitle: run.title,
      scheduledStartAt: run.scheduledStartAt,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    await activityRepository.create({
      userId: user.id,
      type: "RUN_REACTIVATED",
      message: "Reactivated a cancelled run.",
    });
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "RUN_REACTIVATED",
      summary: "Cancelled run reactivated.",
      payload: { fromStatus: "CANCELLED", cancelRevision: expectedCancelRevision },
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
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "RUN_STARTED",
      summary: "Run started.",
      payload: { fromStatus: "PUBLISHED", toStatus: "IN_PROGRESS", selectedCount: selectedSignupIds.length },
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
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "RUN_COMPLETED",
      summary: "Run completed.",
      payload: { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED" },
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
