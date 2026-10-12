import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageCommunitySchedule,
  canMaterializeCommunityScheduleOccurrence,
  canViewCommunitySchedule,
  isEligibleRaidLead,
} from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  MAX_SLOTS_PER_PLAN,
  compareScheduleOccurrences,
  resolveScheduleSlotOccurrence,
  type RaidIdWindow,
  type ScheduleOccurrence,
  resolveScheduleStartBoundary,
  isBeforeScheduleStart,
  scheduleDraftRelease,
  type ScheduleRunCounts,
  type ScheduleStart,
} from "@/lib/community-schedule";
import {
  normalizeScheduleCompositionWrite,
  resolveEffectiveRunComposition,
  type EffectiveRunComposition,
} from "@/lib/run-composition";
import {
  projectRunStaffingFromRun,
  type RunStaffingProjection,
} from "@/lib/run-staffing";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { DomainError } from "@/lib/errors";
import {
  matchProductForContents,
  type ContentBossCounts,
  type PlanningProduct,
} from "@/lib/product-selection";
import { isSelectableProduct, productPlanningService } from "@/services/product-planning.service";
import { getDiscordManagementScheduleRoleId } from "@/lib/discord-config";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import {
  formatCommunityScheduleShare,
  formatScheduleShareRunDescription,
  type FormatCommunityScheduleShareResult,
} from "@/lib/community-schedule-share";
import { db, orm } from "@/lib/prisma";
import {
  COMMUNITY_WEEKDAYS,
  type CommunityScheduleRunMode,
  type CommunityWeekday,
  type RaidDifficulty,
  type RunLootType,
  type RunStatus,
} from "@/models/enums";
import {
  communityScheduleRunRepository,
  type CommunityScheduleRunRecord,
} from "@/repositories/community-schedule-run.repository";
import {
  adoptRunSetupInTx,
  attachExistingRunInTx,
  mapAttachUniqueViolation,
  recordRunScheduleAttached,
} from "@/services/community-schedule-occurrence.service";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runDomainEventService } from "@/services/run-domain-event.service";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { userRepository } from "@/repositories/user.repository";
import {
} from "@/services/community-schedule-materialization.service";
import {
  computeUsability,
  runTemplateService,
  templateContentDisplay,
  templateCoverage,
} from "@/services/run-template.service";
import type {
  AddScheduleTimesInput,
  CreateCommunityScheduleSlotInput,
  CreateSchedulePlanInput,
  UpdateCommunityScheduleSlotInput,
} from "@/validators/community-schedule";
import type { CreateRunTemplateInput, UpdateRunTemplateInput } from "@/validators/run-template";

/**
 * What a Schedule mutation did to Runs it had created. Only MATERIALIZED +
 * still-DRAFT future Runs are Schedule-owned and get retired (archived);
 * everything else is reported as unchanged.
 */
export type ScheduleDraftCleanup = ScheduleRunCounts;

type ScheduleMutationResult<T> = T & { cleanup: ScheduleDraftCleanup };

const NO_CLEANUP: ScheduleDraftCleanup = { retiredDrafts: 0, protectedRuns: 0, attachedRuns: 0 };

type TxOrm = typeof orm;

export type ScheduleOccurrenceMaterializationState =
  | "RUN_CREATED"
  | "NO_RUN_YET"
  | "AUTO_WAITING"
  | "AUTO_BLOCKED"
  /** Before the slot's activation boundary: intentionally no Run is created. */
  | "NOT_STARTED"
  | "PAST";

/** A persisted occurrence (CommunityScheduleRun) as the Schedule view needs it. */
type OccurrenceLink = { runId: string; origin: "MATERIALIZED" | "ATTACHED" };

export type CommunityScheduleOccurrenceView = {
  state: ScheduleOccurrenceMaterializationState;
  runId?: string;
  /** For RUN_CREATED: materialized from the Run Setup, or an existing Run attached. */
  origin?: "MATERIALIZED" | "ATTACHED";
  /** For NOT_STARTED: raid-ID window start of the slot's first eligible occurrence. */
  startsWindowStartAt?: string;
  /** "Use existing Run" is offered (unfulfilled, not past, started, manageable). */
  canAttach: boolean;
  /**
   * Weekly Draft release for this occurrence's raid ID (the Monday 12:00
   * Europe/Berlin before its Wednesday reset). AUTO_WAITING: still ahead.
   */
  draftReleaseAt?: string;
  /** Neutral explanation (e.g. the release already passed before this time was planned). */
  note?: string;
  blockedReason?: string;
  templateLabel?: string;
  autoCreateRun: boolean;
  canMaterialize: boolean;
};

/**
 * Read-only staffing overlay for one Schedule occurrence.
 * MATERIALIZED → Run snapshot desired + authoritative selected roster.
 * UNMATERIALIZED → planning target preview only (no fake Staffed/Missing).
 */
export type CommunityScheduleOccurrenceStaffing =
  | {
      kind: "RUN";
      runStatus: RunStatus;
      projection: RunStaffingProjection;
    }
  | {
      kind: "PREVIEW";
      target: EffectiveRunComposition;
    }
  | { kind: "NONE" };

export type CommunityScheduleProjectedSlot = {
  slot: CommunityScheduleSlotRecord;
  occurrence: ScheduleOccurrence;
  materialization: CommunityScheduleOccurrenceView;
  staffing: CommunityScheduleOccurrenceStaffing;
};

export type CommunityScheduleDayGroup = {
  localDate: string;
  weekday: CommunityScheduleSlotRecord["weekday"];
  slots: CommunityScheduleProjectedSlot[];
};

export type CommunityScheduleWindowView = {
  window: RaidIdWindow;
  windowStart: string;
  windowEnd: string;
  days: CommunityScheduleDayGroup[];
};

export type CommunityScheduleTemplateOption = {
  id: string;
  label: string;
  usable: boolean;
  unusableReason: string | null;
  /** Authoritative RunTemplate fields for in-schedule Edit Run Setup. */
  name: string;
  /** The active Product these contents match (edit preselection); null when none matches. */
  productId: string | null;
  contentBossCounts: ContentBossCounts;
  productLabel: string;
  titleCoverage: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  notes: string | null;
};

export type CommunityScheduleRunSetupSlot = {
  id: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  isActive: boolean;
  autoCreateRun: boolean;
  runMode: CommunityScheduleRunMode;
  label: string;
  notes: string | null;
  compositionOverrideEnabled: boolean;
  /** Resolved composition for display (template defaults or override). */
  effectiveComposition: EffectiveRunComposition | null;
  /** ADMIN/OWNER may hard-delete planning regardless of materialization history. */
  canDelete: boolean;
  /** Future Runs of this time — what a delete / deactivate / time change would do to them. */
  runCounts: ScheduleRunCounts;
};

export type CommunityScheduleRunSetupGroup = {
  key: string;
  runTemplateId: string | null;
  runSetupName: string;
  raidLeadId: string;
  raidLeadName: string;
  slots: CommunityScheduleRunSetupSlot[];
  slotCount: number;
  autoCreateSummary: "ON" | "OFF" | "MIXED";
  canEdit: boolean;
  /** ADMIN/OWNER may delete the setup + its slots; concrete Runs remain. */
  canDelete: boolean;
  runCounts: ScheduleRunCounts;
};

/** Reusable Run Setup inventory (includes zero-slot presets). */
export type CommunityScheduleRunSetupInventoryItem = {
  id: string;
  name: string;
  productLabel: string;
  titleCoverage: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  notes: string | null;
  isActive: boolean;
  usable: boolean;
  unusableReason: string | null;
  slotCount: number;
  productId: string | null;
  contentBossCounts: ContentBossCounts;
  canEdit: boolean;
  canDelete: boolean;
};

export type CommunitySchedulePage = {
  canEdit: boolean;
  timeZone: string;
  current: CommunityScheduleWindowView;
  next: CommunityScheduleWindowView;
  slots: CommunityScheduleSlotRecord[];
  /** Weekly Plan groups (slots only — zero-slot setups are not listed here). */
  runSetups: CommunityScheduleRunSetupGroup[];
  /** Future Runs per slot id (managers only) — for delete / deactivate / edit consequences. */
  runCountsBySlotId: Record<string, ScheduleRunCounts>;
  /** Full reusable preset inventory including zero-slot setups. */
  runSetupInventory: CommunityScheduleRunSetupInventoryItem[];
  eligibleRaidLeads: Array<{ id: string; name: string }>;
  templates: CommunityScheduleTemplateOption[];
  /** Run Setup product selector: active + selectable Products (DB authority). */
  products: PlanningProduct[];
  share: FormatCommunityScheduleShareResult;
};

function requireView(user: AuthenticatedUser): void {
  if (!canViewCommunitySchedule(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Management access is required.", 403);
  }
}

function requireManage(user: AuthenticatedUser): void {
  if (!canManageCommunitySchedule(user.accountRole)) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Admin permission is required to edit the community schedule.",
      403,
    );
  }
}

async function requireEligibleRaidLead(raidLeadId: string): Promise<void> {
  const lead = await userRepository.findById(raidLeadId);
  if (!lead || !isEligibleRaidLead(lead)) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_RAID_LEAD_INVALID",
      "Choose an eligible raid lead.",
      400,
    );
  }
}

async function assertNoDuplicate(input: {
  raidLeadId: string;
  weekday: CommunityScheduleSlotRecord["weekday"];
  localStartTime: string;
  excludeId?: string;
}): Promise<void> {
  const existing = await communityScheduleRepository.findDuplicate(input);
  if (existing) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_DUPLICATE",
      `${existing.raidLeadName} already has a schedule slot on ${existing.weekday} at ${existing.localStartTime}.`,
      409,
    );
  }
}

function assertBatchSlotLimits(slots: ReadonlyArray<{ weekday: string; localStartTime: string }>): void {
  if (slots.length === 0) {
    throw new DomainError("COMMUNITY_SCHEDULE_SLOTS_EMPTY", "Add at least one weekly time.", 400);
  }
  if (slots.length > MAX_SLOTS_PER_PLAN) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_SLOTS_TOO_MANY",
      `At most ${MAX_SLOTS_PER_PLAN} times per plan.`,
      400,
    );
  }
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.weekday}\0${slot.localStartTime}`;
    if (seen.has(key)) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_BATCH_DUPLICATE",
        "Duplicate weekday and time in this batch.",
        400,
      );
    }
    seen.add(key);
  }
}

async function assertNoConflictsForLead(
  raidLeadId: string,
  pairs: ReadonlyArray<{ weekday: CommunityWeekday; localStartTime: string }>,
): Promise<void> {
  const conflicts = await communityScheduleRepository.findDuplicatesForLead(raidLeadId, pairs);
  if (conflicts.length === 0) return;
  const first = conflicts[0]!;
  throw new DomainError(
    "COMMUNITY_SCHEDULE_DUPLICATE",
    `${first.raidLeadName} already has a schedule slot on ${first.weekday} at ${first.localStartTime}.`,
    409,
  );
}

function templateLabel(template: RunTemplateRecord): string {
  const coverage = templateCoverage(template);
  const display = templateContentDisplay(template);
  return `${template.name} · ${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} ${coverage.titleCoverage} · ${display.productLabel}`;
}

function templateProductFields(
  template: RunTemplateRecord,
  activeProducts: readonly PlanningProduct[],
): {
  productId: string | null;
  contentBossCounts: ContentBossCounts;
  productLabel: string;
  titleCoverage: string;
} {
  const contentRows = template.contents;
  const coverage = templateCoverage(template);
  const display = templateContentDisplay(template);
  const selection = matchProductForContents(activeProducts, contentRows);
  return {
    productId: selection?.productId ?? null,
    contentBossCounts: selection?.contentBossCounts ?? {},
    productLabel: display.productLabel,
    titleCoverage: coverage.titleCoverage,
  };
}

async function validateTemplateLink(input: {
  runTemplateId: string | null;
  autoCreateRun: boolean;
}): Promise<RunTemplateRecord | null> {
  if (input.autoCreateRun && !input.runTemplateId) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_REQUIRED",
      "Choose a run setup when auto-create is enabled.",
      400,
    );
  }
  if (!input.runTemplateId) {
    return null;
  }
  const template = await runTemplateRepository.findById(input.runTemplateId);
  if (!template) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      "Choose a valid run setup.",
      400,
    );
  }
  const usability = computeUsability(template, await productPlanningService.listActive());
  if (input.autoCreateRun && !usability.usable) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      usability.unusableReason ?? "This run setup is not usable for auto-create.",
      400,
    );
  }
  return template;
}

function slotEffectiveComposition(
  slot: CommunityScheduleSlotRecord,
  template: RunTemplateRecord | null | undefined,
): EffectiveRunComposition | null {
  if (!template) return null;
  return resolveEffectiveRunComposition({
    template,
    scheduleSlot: slot,
  });
}

/**
 * One batched Run/roster load for all materialized CURRENT/NEXT occurrences,
 * then in-memory staffing projection. Unmaterialized rows get planning PREVIEW only.
 */
async function attachOccurrenceStaffing(
  windows: CommunityScheduleWindowView[],
  templatesById: Map<string, RunTemplateRecord>,
): Promise<void> {
  const runIds: string[] = [];
  for (const window of windows) {
    for (const day of window.days) {
      for (const row of day.slots) {
        const runId = row.materialization.runId;
        if (runId) runIds.push(runId);
      }
    }
  }

  const runs = await runRepository.listManagedByIds(runIds);
  const staffingByRunId = new Map(
    runs.map((run) => [
      run.id,
      {
        kind: "RUN" as const,
        runStatus: run.status,
        projection: projectRunStaffingFromRun(run),
      },
    ]),
  );

  for (const window of windows) {
    for (const day of window.days) {
      for (const row of day.slots) {
        const runId = row.materialization.runId;
        if (runId) {
          row.staffing = staffingByRunId.get(runId) ?? { kind: "NONE" };
          continue;
        }
        if (row.materialization.state === "PAST") {
          row.staffing = { kind: "NONE" };
          continue;
        }
        const template = row.slot.runTemplateId
          ? templatesById.get(row.slot.runTemplateId)
          : null;
        const target = slotEffectiveComposition(row.slot, template);
        row.staffing = target ? { kind: "PREVIEW", target } : { kind: "NONE" };
      }
    }
  }
}

function weekdaySortIndex(weekday: CommunityWeekday): number {
  return COMMUNITY_WEEKDAYS.indexOf(weekday);
}

function compareSetupSlots(a: CommunityScheduleRunSetupSlot, b: CommunityScheduleRunSetupSlot): number {
  const byDay = weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday);
  if (byDay !== 0) return byDay;
  const byTime = a.localStartTime.localeCompare(b.localStartTime);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

function autoCreateSummary(slots: ReadonlyArray<{ autoCreateRun: boolean }>): "ON" | "OFF" | "MIXED" {
  if (slots.length === 0) return "OFF";
  const onCount = slots.filter((slot) => slot.autoCreateRun).length;
  if (onCount === 0) return "OFF";
  if (onCount === slots.length) return "ON";
  return "MIXED";
}

function groupRunSetups(
  slots: CommunityScheduleSlotRecord[],
  canEdit: boolean,
  templatesById: Map<string, RunTemplateRecord>,
  runCountsBySlot: Map<string, ScheduleRunCounts>,
): CommunityScheduleRunSetupGroup[] {
  const groups = new Map<string, CommunityScheduleRunSetupGroup>();
  for (const slot of slots) {
    const key = `${slot.runTemplateId ?? "none"}:${slot.raidLeadId}`;
    let group = groups.get(key);
    if (!group) {
      const template = slot.runTemplateId ? templatesById.get(slot.runTemplateId) : null;
      const runSetupName = template
        ? `${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} · ${templateContentDisplay(template).productLabel}`
        : (slot.runTemplateName ?? "Unconfigured Schedule");
      group = {
        key,
        runTemplateId: slot.runTemplateId,
        runSetupName,
        raidLeadId: slot.raidLeadId,
        raidLeadName: slot.raidLeadName,
        slots: [],
        slotCount: 0,
        autoCreateSummary: "OFF",
        canEdit,
        canDelete: Boolean(canEdit && slot.runTemplateId),
        runCounts: { ...NO_CLEANUP },
      };
      groups.set(key, group);
    }
    const template = slot.runTemplateId ? templatesById.get(slot.runTemplateId) : null;
    group.slots.push({
      id: slot.id,
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      isActive: slot.isActive,
      autoCreateRun: slot.autoCreateRun,
      runMode: slot.runMode,
      label: slot.label,
      notes: slot.notes,
      compositionOverrideEnabled: slot.compositionOverrideEnabled,
      effectiveComposition: slotEffectiveComposition(slot, template),
      canDelete: canEdit,
      runCounts: runCountsBySlot.get(slot.id) ?? { ...NO_CLEANUP },
    });
    group.runCounts = sumCleanup(group.runCounts, runCountsBySlot.get(slot.id) ?? NO_CLEANUP);
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.slots.sort(compareSetupSlots);
    group.slotCount = group.slots.length;
    group.autoCreateSummary = autoCreateSummary(group.slots);
    group.canDelete = Boolean(canEdit && group.runTemplateId);
  }
  result.sort((a, b) => {
    const byName = a.runSetupName.localeCompare(b.runSetupName);
    if (byName !== 0) return byName;
    return a.raidLeadName.localeCompare(b.raidLeadName);
  });
  return result;
}

function buildRunSetupInventory(
  templates: RunTemplateRecord[],
  slots: CommunityScheduleSlotRecord[],
  canEdit: boolean,
  activeProducts: readonly PlanningProduct[],
): CommunityScheduleRunSetupInventoryItem[] {
  const slotCountByTemplate = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.runTemplateId) continue;
    slotCountByTemplate.set(
      slot.runTemplateId,
      (slotCountByTemplate.get(slot.runTemplateId) ?? 0) + 1,
    );
  }

  const items = templates.map((template) => {
    const usability = computeUsability(template, activeProducts);
    const product = templateProductFields(template, activeProducts);
    return {
      id: template.id,
      name: template.name,
      productLabel: product.productLabel,
      titleCoverage: product.titleCoverage,
      difficulty: template.difficulty,
      lootType: template.lootType,
      desiredTankCount: template.desiredTankCount,
      desiredHealerCount: template.desiredHealerCount,
      desiredDpsCount: template.desiredDpsCount,
      desiredLootbuddyCount: template.desiredLootbuddyCount,
      notes: template.notes,
      isActive: template.isActive,
      usable: usability.usable,
      unusableReason: usability.unusableReason,
      slotCount: slotCountByTemplate.get(template.id) ?? 0,
      productId: product.productId,
      contentBossCounts: product.contentBossCounts,
      canEdit,
      canDelete: canEdit,
    };
  });

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** The Monday 12:00 (Europe/Berlin) release that targets the raid ID starting at `windowStartAt`. */
function draftReleaseFor(windowStartAt: string): string {
  return scheduleDraftRelease(new Date(Date.parse(windowStartAt) - 1), COMMUNITY_SCHEDULE_TIME_ZONE).releaseAt;
}

function buildMaterializationView(input: {
  user: AuthenticatedUser;
  slot: CommunityScheduleSlotRecord;
  occurrence: ScheduleOccurrence;
  link: OccurrenceLink | null;
  templateLabel: string | null;
  templateUsable: boolean | null;
  templateUnusableReason: string | null;
  now: Date;
}): CommunityScheduleOccurrenceView {
  const { slot, occurrence, user, now } = input;
  const autoCreateRun = slot.autoCreateRun;
  const canManage = slot.isActive && canMaterializeCommunityScheduleOccurrence(user, slot);
  const canMaterialize = canManage && slot.runTemplateId != null && (input.templateUsable ?? false);

  if (input.link) {
    return {
      state: "RUN_CREATED",
      runId: input.link.runId,
      origin: input.link.origin,
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
      canAttach: false,
    };
  }

  if (Date.parse(occurrence.scheduledStartAt) < now.getTime()) {
    return {
      state: "PAST",
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
      canAttach: false,
    };
  }

  if (isBeforeScheduleStart(slot.firstWindowStartAt, occurrence.windowStartAt)) {
    // Before the start boundary the occurrence does not exist: nothing to create or attach.
    return {
      state: "NOT_STARTED",
      startsWindowStartAt: slot.firstWindowStartAt!,
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
      canAttach: false,
    };
  }

  // Unfulfilled, upcoming and started from here on: an existing Run may satisfy it.
  const canAttach = canManage;
  const draftReleaseAt = draftReleaseFor(occurrence.windowStartAt);

  if (!slot.runTemplateId) {
    return {
      state: "NO_RUN_YET",
      autoCreateRun,
      canMaterialize: false,
      canAttach,
    };
  }

  if (autoCreateRun) {
    if (input.templateUsable) {
      if (Date.parse(draftReleaseAt) > now.getTime()) {
        return {
          state: "AUTO_WAITING",
          draftReleaseAt,
          templateLabel: input.templateLabel ?? undefined,
          autoCreateRun,
          canMaterialize,
          canAttach,
        };
      }
      // The weekly release already passed (e.g. time planned mid-week): no catch-up on save.
      return {
        state: "NO_RUN_YET",
        draftReleaseAt,
        note: "This raid ID's Draft release already passed — use Create Run if it should take place.",
        templateLabel: input.templateLabel ?? undefined,
        autoCreateRun,
        canMaterialize,
        canAttach,
      };
    }
    return {
      state: "AUTO_BLOCKED",
      blockedReason: input.templateUnusableReason ?? "Run Setup is not usable.",
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
      canAttach,
    };
  }

  return {
    state: "NO_RUN_YET",
    templateLabel: input.templateLabel ?? undefined,
    autoCreateRun,
    canMaterialize,
    canAttach,
  };
}

function projectWindow(
  user: AuthenticatedUser,
  slots: CommunityScheduleSlotRecord[],
  window: RaidIdWindow,
  now: Date,
  linksByKey: Map<string, OccurrenceLink>,
  templateMetaById: Map<
    string,
    { label: string; usable: boolean; unusableReason: string | null }
  >,
): CommunityScheduleWindowView {
  const classification = classifyRunWeek({
    scheduledStartAt: now.toISOString(),
    now,
    timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
  });
  const windowStart = window === "CURRENT" ? classification.currentStart : classification.nextStart;
  const windowEnd = window === "CURRENT" ? classification.nextStart : classification.followingStart;

  const projected: CommunityScheduleProjectedSlot[] = [];
  for (const slot of slots) {
    if (!slot.isActive) continue;
    const occurrence = resolveScheduleSlotOccurrence({
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      window,
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });
    const linkKey = `${slot.id}\0${occurrence.windowStartAt}`;
    const link = linksByKey.get(linkKey) ?? null;
    const templateMeta = slot.runTemplateId ? templateMetaById.get(slot.runTemplateId) : null;

    projected.push({
      slot,
      occurrence,
      materialization: buildMaterializationView({
        user,
        slot,
        occurrence,
        link,
        templateLabel: templateMeta?.label ?? slot.runTemplateName,
        templateUsable: templateMeta?.usable ?? null,
        templateUnusableReason: templateMeta?.unusableReason ?? null,
        now,
      }),
      // Filled in getPage after one batched roster load (or PREVIEW from planning).
      staffing: { kind: "NONE" },
    });
  }

  projected.sort((a, b) =>
    compareScheduleOccurrences(
      { scheduledStartAt: a.occurrence.scheduledStartAt, slotId: a.slot.id },
      { scheduledStartAt: b.occurrence.scheduledStartAt, slotId: b.slot.id },
    ),
  );

  const byDate = new Map<string, CommunityScheduleDayGroup>();
  for (const row of projected) {
    const key = row.occurrence.localDate;
    let group = byDate.get(key);
    if (!group) {
      group = {
        localDate: key,
        weekday: row.slot.weekday,
        slots: [],
      };
      byDate.set(key, group);
    }
    group.slots.push(row);
  }

  return {
    window,
    windowStart,
    windowEnd,
    days: [...byDate.values()],
  };
}

async function listTemplateOptions(_user: AuthenticatedUser): Promise<{
  options: CommunityScheduleTemplateOption[];
  recordsById: Map<string, RunTemplateRecord>;
  products: PlanningProduct[];
}> {
  // Templates + the product catalog: two bounded queries, no per-template lookups.
  const [templates, products] = await Promise.all([
    runTemplateRepository.listAll(),
    productPlanningService.listAll(),
  ]);
  const activeProducts = products.filter((product) => product.active);

  const recordsById = new Map(templates.map((template) => [template.id, template]));
  const options = templates.map((template) => {
    const usability = computeUsability(template, activeProducts);
    const product = templateProductFields(template, activeProducts);
    return {
      id: template.id,
      label: templateLabel(template),
      usable: usability.usable,
      unusableReason: usability.unusableReason,
      name: template.name,
      productId: product.productId,
      contentBossCounts: product.contentBossCounts,
      productLabel: product.productLabel,
      titleCoverage: product.titleCoverage,
      difficulty: template.difficulty,
      lootType: template.lootType,
      desiredTankCount: template.desiredTankCount,
      desiredHealerCount: template.desiredHealerCount,
      desiredDpsCount: template.desiredDpsCount,
      desiredLootbuddyCount: template.desiredLootbuddyCount,
      notes: template.notes,
    };
  });
  return { options, recordsById, products };
}

function resolveTxOrm(tx: { orm: unknown }): TxOrm {
  return ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
}

async function createSlotsInTx(input: {
  txOrm: TxOrm;
  slots: ReadonlyArray<{
    weekday: CommunityWeekday;
    localStartTime: string;
    runMode: CommunityScheduleRunMode;
    attachRunId?: string | null;
  }>;
  label: string;
  notes: string | null;
  raidLeadId: string;
  runTemplateId: string;
  autoCreateRun: boolean;
  composition: ReturnType<typeof normalizeScheduleCompositionWrite>;
  start: ScheduleStart | undefined;
  actor: AuthenticatedUser;
  now: Date;
}): Promise<{ slotIds: string[]; attached: AttachedOccurrence[] }> {
  const slotIds: string[] = [];
  const attached: AttachedOccurrence[] = [];
  for (const slot of input.slots) {
    const created = await communityScheduleRepository.create(
      {
        weekday: slot.weekday,
        localStartTime: slot.localStartTime,
        label: input.label,
        notes: input.notes,
        raidLeadId: input.raidLeadId,
        runTemplateId: input.runTemplateId,
        autoCreateRun: input.autoCreateRun,
        runMode: slot.runMode,
        firstWindowStartAt: resolveStartBoundary(slot, input.start, input.now),
        composition: input.composition,
        createdById: input.actor.id,
        updatedById: input.actor.id,
      },
      input.txOrm,
    );
    slotIds.push(created.id);
    // Committed with the slot, before any immediate auto-create can claim the occurrence.
    if (slot.attachRunId) {
      const link = await attachExistingRunInTx(input.txOrm, {
        slot: created,
        runId: slot.attachRunId,
        actor: input.actor,
        now: input.now,
      });
      attached.push({ slot: created, link });
    }
  }
  return { slotIds, attached };
}

type AttachedOccurrence = { slot: CommunityScheduleSlotRecord; link: CommunityScheduleRunRecord };

/** Activation boundary for a start choice; omitted / IMMEDIATE → null (legacy behavior). */
function resolveStartBoundary(
  slot: { weekday: CommunityWeekday; localStartTime: string },
  start: ScheduleStart | undefined,
  now: Date,
): string | null {
  if (!start || start.mode === "IMMEDIATE") return null;
  try {
    return resolveScheduleStartBoundary({
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      start,
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    }).firstWindowStartAt;
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Choose a valid start date.", 400);
  }
}

async function auditAttached(actor: AuthenticatedUser, attached: readonly AttachedOccurrence[]): Promise<void> {
  for (const row of attached) {
    await recordRunScheduleAttached({ actor, slot: row.slot, link: row.link });
  }
}

/**
 * Retires the slot's Schedule-owned Drafts (origin MATERIALIZED, still DRAFT,
 * unarchived, starting after `now`) for which `affects(link)` is true, and
 * frees their occurrence. Runs inside the caller's transaction, after the
 * slot row is locked (so a concurrent materialization either committed
 * before — and is cleaned up here — or re-checks the changed slot and aborts).
 * Non-DRAFT and ATTACHED Runs are only counted, never touched.
 */
async function retireOwnedDraftsInTx(
  txOrm: TxOrm,
  input: {
    slotId: string;
    actor: AuthenticatedUser;
    now: Date;
    affects: (link: CommunityScheduleRunRecord) => boolean;
  },
): Promise<{ cleanup: ScheduleDraftCleanup; retiredRunIds: string[] }> {
  const cleanup: ScheduleDraftCleanup = { retiredDrafts: 0, protectedRuns: 0, attachedRuns: 0 };
  const retiredRunIds: string[] = [];
  const links = await communityScheduleRunRepository.listBySlotIds([input.slotId], txOrm);
  for (const link of links) {
    if (!input.affects(link)) continue;
    if (link.origin === "ATTACHED") {
      if (Date.parse(link.occurrenceStartAt) > input.now.getTime()) cleanup.attachedRuns += 1;
      continue;
    }
    const retired = await runRepository.retireScheduleDraftInTx(txOrm, {
      runId: link.runId,
      actorId: input.actor.id,
      notBefore: input.now,
    });
    if (retired) {
      await communityScheduleRunRepository.releaseFromSlotInTx(link.id, txOrm);
      cleanup.retiredDrafts += 1;
      retiredRunIds.push(link.runId);
    } else if (Date.parse(link.occurrenceStartAt) > input.now.getTime()) {
      cleanup.protectedRuns += 1;
    }
  }
  return { cleanup, retiredRunIds };
}

async function auditRetiredDrafts(actor: AuthenticatedUser, runIds: readonly string[], reason: string): Promise<void> {
  for (const runId of runIds) {
    await runDomainEventService.record({
      runId,
      actorUser: actor,
      type: "RUN_SCHEDULE_DRAFT_RETIRED",
      summary: `Schedule Draft archived: ${reason}.`,
      payload: { reason },
    });
  }
}

/**
 * Per slot: future Runs it created that are still Drafts (a delete / deactivate
 * / time change archives them), created Runs that left Draft, and linked
 * existing Runs (both never changed). Same ownership rule as the cleanup.
 */
async function futureRunCountsBySlot(
  links: readonly CommunityScheduleRunRecord[],
  now: Date,
): Promise<Map<string, ScheduleRunCounts>> {
  const relevant = links.filter(
    (link) => link.scheduleSlotId != null && Date.parse(link.occurrenceStartAt) > now.getTime(),
  );
  const runs = new Map(
    (await runRepository.listLifecycleByIds(relevant.map((link) => link.runId))).map((run) => [run.id, run]),
  );
  const result = new Map<string, ScheduleRunCounts>();
  for (const link of relevant) {
    const run = runs.get(link.runId);
    if (!run || run.archivedAt != null || run.status === "CANCELLED") continue;
    const counts = result.get(link.scheduleSlotId!) ?? { ...NO_CLEANUP };
    if (link.origin === "ATTACHED") counts.attachedRuns += 1;
    else if (run.status === "DRAFT" && Date.parse(run.scheduledStartAt) > now.getTime()) counts.retiredDrafts += 1;
    else counts.protectedRuns += 1;
    result.set(link.scheduleSlotId!, counts);
  }
  return result;
}

function sumCleanup(a: ScheduleDraftCleanup, b: ScheduleDraftCleanup): ScheduleDraftCleanup {
  return {
    retiredDrafts: a.retiredDrafts + b.retiredDrafts,
    protectedRuns: a.protectedRuns + b.protectedRuns,
    attachedRuns: a.attachedRuns + b.attachedRuns,
  };
}

function buildShareFromSlots(
  slots: CommunityScheduleSlotRecord[],
  templatesById: Map<string, RunTemplateRecord>,
): FormatCommunityScheduleShareResult {
  const active = slots.filter((slot) => slot.isActive);
  let usedLabelFallback = false;
  const shareSlots = active.map((slot) => {
    const template = slot.runTemplateId ? templatesById.get(slot.runTemplateId) : null;
    let runDescription: string;
    if (template) {
      runDescription = formatScheduleShareRunDescription({
        titleCoverage: templateCoverage(template).titleCoverage,
        difficulty: template.difficulty,
        lootType: template.lootType,
      });
    } else {
      usedLabelFallback = true;
      runDescription = slot.label;
    }
    return {
      id: slot.id,
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      runMode: slot.runMode,
      runDescription,
      raidLeadDiscordId: slot.raidLeadDiscordUserId,
      raidLeadName: slot.raidLeadName,
    };
  });
  const formatted = formatCommunityScheduleShare({
    managementRoleId: getDiscordManagementScheduleRoleId(),
    slots: shareSlots,
  });
  if (usedLabelFallback) {
    formatted.warnings.push(
      "Some Schedule entries have no Run Setup and were exported using their Schedule label.",
    );
  }
  return formatted;
}

/**
 * Community Weekly Schedule — recurring planning intent with optional DRAFT Run
 * materialization per raid-ID window. Never auto-opens Runs or Discord state.
 */
export const communityScheduleService = {
  async getPage(user: AuthenticatedUser, now = new Date()): Promise<CommunitySchedulePage> {
    requireView(user);
    const canEdit = canManageCommunitySchedule(user.accountRole);
    const [slots, eligibleRaidLeads, templateBundle] = await Promise.all([
      communityScheduleRepository.listAll(),
      canEdit ? userRepository.listEligibleRaidLeads() : Promise.resolve([]),
      listTemplateOptions(user),
    ]);
    if (canEdit) {
      await raidRepository.ensureReferenceRaids();
    }

    const { options: templates, recordsById: templatesById, products } = templateBundle;
    const activeProducts = products.filter((product) => product.active);

    const templateMetaById = new Map<
      string,
      { label: string; usable: boolean; unusableReason: string | null }
    >();
    for (const option of templates) {
      templateMetaById.set(option.id, {
        label: option.label,
        usable: option.usable,
        unusableReason: option.unusableReason,
      });
    }

    const slotIds = slots.map((slot) => slot.id);
    const links = await communityScheduleRunRepository.listBySlotIds(slotIds);
    const linksByKey = new Map<string, OccurrenceLink>();
    for (const link of links) {
      if (link.scheduleSlotId == null) continue;
      linksByKey.set(`${link.scheduleSlotId}\0${link.windowStartAt}`, { runId: link.runId, origin: link.origin });
    }

    const visibleSlots = canEdit ? slots : slots.filter((slot) => slot.isActive);
    const runCountsBySlot = canEdit ? await futureRunCountsBySlot(links, now) : new Map<string, ScheduleRunCounts>();
    const allTemplates = [...templatesById.values()];

    const current = projectWindow(user, slots, "CURRENT", now, linksByKey, templateMetaById);
    const next = projectWindow(user, slots, "NEXT", now, linksByKey, templateMetaById);
    await attachOccurrenceStaffing([current, next], templatesById);

    return {
      canEdit,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      current,
      next,
      slots: visibleSlots,
      runSetups: groupRunSetups(visibleSlots, canEdit, templatesById, runCountsBySlot),
      runCountsBySlotId: Object.fromEntries(runCountsBySlot),
      runSetupInventory: buildRunSetupInventory(allTemplates, visibleSlots, canEdit, activeProducts),
      eligibleRaidLeads: eligibleRaidLeads.map((lead) => ({ id: lead.id, name: lead.name })),
      templates: canEdit ? templates : templates.filter((row) => row.usable),
      products: products.filter(isSelectableProduct),
      share: buildShareFromSlots(visibleSlots, templatesById),
    };
  },

  /**
   * Schedule-surface edit of a shared Run Setup (RunTemplate).
   * ADMIN/OWNER only — does not widen RAID_LEAD schedule mutation rights.
   * Reuses runTemplateService.updateTemplate validation; never mutates Runs.
   */
  async updateRunSetup(
    user: AuthenticatedUser,
    input: UpdateRunTemplateInput,
  ): Promise<{ id: string }> {
    requireManage(user);
    return runTemplateService.updateTemplate(user, input);
  },

  async createSchedulePlan(
    user: AuthenticatedUser,
    input: CreateSchedulePlanInput,
    now?: Date,
  ): Promise<{ templateId: string; slotIds: string[] }> {
    requireManage(user);
    assertBatchSlotLimits(input.slots);
    await requireEligibleRaidLead(input.raidLeadId);
    await assertNoConflictsForLead(input.raidLeadId, input.slots);

    let templateId: string;
    let templateName: string;

    const composition = normalizeScheduleCompositionWrite(input);

    const adoptFromRunId = input.runSetup.mode === "fromRun" ? input.runSetup.runId : null;
    if (adoptFromRunId && !input.slots.some((slot) => slot.attachRunId === adoptFromRunId)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "The Run Setup can only be adopted from the existing Run used as a first occurrence.",
        400,
      );
    }

    if (input.runSetup.mode === "existing") {
      const template = await validateTemplateLink({
        runTemplateId: input.runSetup.templateId,
        autoCreateRun: input.autoCreateRun,
      });
      if (!template) {
        throw new DomainError(
          "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
          "Choose a valid run setup.",
          400,
        );
      }
      templateId = template.id;
      templateName = template.name;
    } else {
      templateId = "";
      templateName = input.runSetup.mode === "create" ? input.runSetup.name.trim() : "";
    }

    const result = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      let resolvedTemplateId = templateId;
      let resolvedName = templateName;

      if (input.runSetup.mode === "create") {
        const created = await runTemplateService.createTemplateInTx(
          user,
          { ...input.runSetup },
          txOrm,
        );
        resolvedTemplateId = created.id;
        resolvedName = input.runSetup.name.trim();
      }
      if (adoptFromRunId) {
        // Same transaction as the slots + attachment: all or nothing.
        const adopted = await adoptRunSetupInTx(txOrm, { runId: adoptFromRunId, actor: user });
        resolvedTemplateId = adopted.templateId;
        resolvedName = adopted.templateName;
      }

      const created = await createSlotsInTx({
        txOrm,
        slots: input.slots,
        label: resolvedName,
        notes: input.notes,
        raidLeadId: input.raidLeadId,
        runTemplateId: resolvedTemplateId,
        autoCreateRun: input.autoCreateRun,
        composition,
        start: input.start,
        actor: user,
        now: now ?? new Date(),
      });

      return { templateId: resolvedTemplateId, slotIds: created.slotIds, attached: created.attached };
    }).catch(mapAttachUniqueViolation);

    await auditAttached(user, result.attached);
    // Planning only: Drafts are released Monday 12:00 (or via manual Create Run).
    return { templateId: result.templateId, slotIds: result.slotIds };
  },

  async addTimesToSetup(
    user: AuthenticatedUser,
    input: AddScheduleTimesInput,
    now?: Date,
  ): Promise<{ templateId: string; slotIds: string[] }> {
    requireManage(user);
    assertBatchSlotLimits(input.slots);
    await requireEligibleRaidLead(input.raidLeadId);

    const template = await validateTemplateLink({
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
    });
    if (!template) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
        "Choose a valid run setup.",
        400,
      );
    }

    await assertNoConflictsForLead(input.raidLeadId, input.slots);
    const composition = normalizeScheduleCompositionWrite(input);

    const { slotIds, attached } = await db
      .transaction(async (tx) => {
        const txOrm = resolveTxOrm(tx);
        return createSlotsInTx({
          txOrm,
          slots: input.slots,
          label: template.name,
          notes: input.notes,
          raidLeadId: input.raidLeadId,
          runTemplateId: template.id,
          autoCreateRun: input.autoCreateRun,
          composition,
          start: input.start,
          actor: user,
          now: now ?? new Date(),
        });
      })
      .catch(mapAttachUniqueViolation);

    await auditAttached(user, attached);
    return { templateId: template.id, slotIds };
  },

  async createSlot(
    user: AuthenticatedUser,
    input: CreateCommunityScheduleSlotInput,
    now?: Date,
  ): Promise<{ slot: CommunityScheduleSlotRecord }> {
    requireManage(user);
    await requireEligibleRaidLead(input.raidLeadId);
    await validateTemplateLink({
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
    });
    await assertNoDuplicate({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
    });
    const composition = normalizeScheduleCompositionWrite(input);
    const slot = await communityScheduleRepository.create({
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      runMode: input.runMode,
      firstWindowStartAt: resolveStartBoundary(input, input.start, now ?? new Date()),
      composition,
      createdById: user.id,
      updatedById: user.id,
    });
    return { slot };
  },

  async updateSlot(
    user: AuthenticatedUser,
    input: UpdateCommunityScheduleSlotInput,
    now?: Date,
  ): Promise<ScheduleMutationResult<{ slot: CommunityScheduleSlotRecord }>> {
    requireManage(user);
    const existing = await communityScheduleRepository.findById(input.slotId);
    if (!existing) {
      throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    }
    await requireEligibleRaidLead(input.raidLeadId);
    await validateTemplateLink({
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
    });
    await assertNoDuplicate({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      excludeId: input.slotId,
    });
    const composition = normalizeScheduleCompositionWrite(input);
    const at = now ?? new Date();
    const result = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      // Lock first: a concurrent Draft materialization for this slot serializes with this edit.
      const locked = await communityScheduleRepository.lockInTx(input.slotId, txOrm);
      if (!locked) {
        throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
      }
      const nextBoundary = input.start ? resolveStartBoundary(input, input.start, at) : locked.firstWindowStartAt;
      const timeChanged = locked.weekday !== input.weekday || locked.localStartTime !== input.localStartTime;
      const boundaryLater =
        nextBoundary != null &&
        (locked.firstWindowStartAt == null || Date.parse(nextBoundary) > Date.parse(locked.firstWindowStartAt));

      const slot = await communityScheduleRepository.update(
        input.slotId,
        {
          weekday: input.weekday,
          localStartTime: input.localStartTime,
          label: input.label,
          notes: input.notes,
          raidLeadId: input.raidLeadId,
          runTemplateId: input.runTemplateId,
          autoCreateRun: input.autoCreateRun,
          runMode: input.runMode,
          // Only an explicit start choice moves the boundary.
          ...(input.start ? { firstWindowStartAt: nextBoundary } : {}),
          composition,
          updatedById: user.id,
        },
        txOrm,
      );
      // A moved weekday / time, or a later start, removes occurrences: their
      // Schedule-owned Drafts are archived and the occurrence freed. No
      // replacement is created here — that is the Monday release (or Create Run).
      const { cleanup, retiredRunIds } = await retireOwnedDraftsInTx(txOrm, {
        slotId: input.slotId,
        actor: user,
        now: at,
        affects: (link) =>
          timeChanged || (boundaryLater && isBeforeScheduleStart(nextBoundary, link.windowStartAt)),
      });
      return { slot, cleanup, retiredRunIds };
    });
    await auditRetiredDrafts(user, result.retiredRunIds, "the schedule time or start changed");
    return { slot: result.slot, cleanup: result.cleanup };
  },

  async deactivateSlot(
    user: AuthenticatedUser,
    slotId: string,
    now: Date = new Date(),
  ): Promise<ScheduleMutationResult<{ slot: CommunityScheduleSlotRecord }>> {
    requireManage(user);
    const result = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      const existing = await communityScheduleRepository.lockInTx(slotId, txOrm);
      if (!existing) {
        throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
      }
      if (!existing.isActive) {
        throw new DomainError(
          "COMMUNITY_SCHEDULE_ALREADY_INACTIVE",
          "This schedule slot is already inactive.",
          409,
        );
      }
      const slot = await communityScheduleRepository.setActive(slotId, false, user.id, txOrm);
      const { cleanup, retiredRunIds } = await retireOwnedDraftsInTx(txOrm, {
        slotId,
        actor: user,
        now,
        affects: () => true,
      });
      return { slot, cleanup, retiredRunIds };
    });
    await auditRetiredDrafts(user, result.retiredRunIds, "the schedule time was deactivated");
    return { slot: result.slot, cleanup: result.cleanup };
  },

  async reactivateSlot(
    user: AuthenticatedUser,
    slotId: string,
  ): Promise<{ slot: CommunityScheduleSlotRecord }> {
    requireManage(user);
    const existing = await communityScheduleRepository.findById(slotId);
    if (!existing) {
      throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    }
    if (existing.isActive) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_ALREADY_ACTIVE",
        "This schedule slot is already active.",
        409,
      );
    }
    await requireEligibleRaidLead(existing.raidLeadId);
    await assertNoDuplicate({
      raidLeadId: existing.raidLeadId,
      weekday: existing.weekday,
      localStartTime: existing.localStartTime,
      excludeId: existing.id,
    });
    // No Draft on reactivation — the next Monday release (or Create Run) creates it.
    const slot = await communityScheduleRepository.setActive(slotId, true, user.id);
    return { slot };
  },

  /**
   * Permanently remove a recurring Schedule time.
   * CommunityScheduleRun.scheduleSlotId is SET NULL; concrete Runs stay.
   */
  async deleteSlot(
    user: AuthenticatedUser,
    slotId: string,
    now: Date = new Date(),
  ): Promise<ScheduleMutationResult<{ id: string }>> {
    requireManage(user);
    const result = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      const existing = await communityScheduleRepository.lockInTx(slotId, txOrm);
      if (!existing) {
        throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
      }
      const retired = await retireOwnedDraftsInTx(txOrm, { slotId, actor: user, now, affects: () => true });
      await communityScheduleRepository.deleteById(slotId, txOrm);
      return retired;
    });
    await auditRetiredDrafts(user, result.retiredRunIds, "the schedule time was deleted");
    return { id: slotId, cleanup: result.cleanup };
  },

  /**
   * Permanently remove a Run Setup and all of its Schedule times.
   * Historical CommunityScheduleRun rows SET NULL on slot delete; Runs stay.
   * Template contents cascade with the template.
   */
  async deleteRunSetup(
    user: AuthenticatedUser,
    runTemplateId: string,
    now: Date = new Date(),
  ): Promise<{ id: string; deletedSlotCount: number; cleanup: ScheduleDraftCleanup }> {
    requireManage(user);
    let deletedSlotCount = 0;
    let cleanup = NO_CLEANUP;
    const retiredRunIds: string[] = [];
    await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      const template = await runTemplateRepository.findById(runTemplateId, txOrm);
      if (!template) {
        throw new DomainError("RUN_TEMPLATE_NOT_FOUND", "Run Setup was not found.", 404);
      }

      const slots = await communityScheduleRepository.listByTemplateId(runTemplateId, txOrm);
      for (const slot of slots) {
        await communityScheduleRepository.lockInTx(slot.id, txOrm);
        const retired = await retireOwnedDraftsInTx(txOrm, { slotId: slot.id, actor: user, now, affects: () => true });
        cleanup = sumCleanup(cleanup, retired.cleanup);
        retiredRunIds.push(...retired.retiredRunIds);
        await communityScheduleRepository.deleteById(slot.id, txOrm);
      }
      deletedSlotCount = slots.length;
      await runTemplateRepository.deleteById(runTemplateId, txOrm);
    });
    await auditRetiredDrafts(user, retiredRunIds, "its Run Setup and schedule times were deleted");
    return { id: runTemplateId, deletedSlotCount, cleanup };
  },

  /** Create a reusable Run Setup without Schedule times (ADMIN/OWNER). */
  async createRunSetup(
    user: AuthenticatedUser,
    input: CreateRunTemplateInput,
  ): Promise<{ id: string }> {
    requireManage(user);
    return runTemplateService.createTemplate(user, input);
  },

  /** Duplicate a Run Setup into a new independent preset (no slots copied). */
  async duplicateRunSetup(
    user: AuthenticatedUser,
    runTemplateId: string,
  ): Promise<{ id: string }> {
    requireManage(user);
    return runTemplateService.duplicateTemplate(user, runTemplateId);
  },
};
