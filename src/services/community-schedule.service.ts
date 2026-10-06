import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageCommunitySchedule,
  canMaterializeCommunityScheduleOccurrence,
  canViewCommunitySchedule,
  hasAdminAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  MAX_SLOTS_PER_PLAN,
  compareScheduleOccurrences,
  resolveScheduleSlotOccurrence,
  type RaidIdWindow,
  type ScheduleOccurrence,
} from "@/lib/community-schedule";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { DomainError, isDomainError } from "@/lib/errors";
import { getDiscordManagementScheduleRoleId } from "@/lib/discord-config";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import {
  formatCommunityScheduleShare,
  formatScheduleShareRunDescription,
  type FormatCommunityScheduleShareResult,
} from "@/lib/community-schedule-share";
import {
  classifyRunContents,
  listCreateRunContentPresets,
  venomousBossMaxFromCatalog,
  type RunContentPresetKey,
} from "@/lib/run-content-presets";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { db, orm } from "@/lib/prisma";
import {
  COMMUNITY_WEEKDAYS,
  type CommunityScheduleRunMode,
  type CommunityWeekday,
  type RaidDifficulty,
  type RunLootType,
} from "@/models/enums";
import {
  communityScheduleRunRepository,
  isForeignKeyViolation,
} from "@/repositories/community-schedule-run.repository";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { userRepository } from "@/repositories/user.repository";
import {
  COMMUNITY_SCHEDULE_MATERIALIZE_WARNING,
  communityScheduleMaterializationService,
  type MaterializeSlotWindowsResult,
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
import type { UpdateRunTemplateInput } from "@/validators/run-template";

const SLOT_DELETE_BLOCKED_MESSAGE =
  "This Schedule time has already created one or more Runs and cannot be deleted. Deactivate it instead.";

const SETUP_DELETE_BLOCKED_MESSAGE =
  "This Run Setup has already been used to create one or more Runs and cannot be deleted. Deactivate its Schedule times instead.";

export type ScheduleMutationMaterialization = {
  created: number;
  failed: number;
  warning: string | null;
};

type ScheduleMutationResult<T> = T & {
  materialization: ScheduleMutationMaterialization;
};

type TxOrm = typeof orm;

export type ScheduleOccurrenceMaterializationState =
  | "RUN_CREATED"
  | "NO_RUN_YET"
  | "AUTO_WAITING"
  | "AUTO_BLOCKED"
  | "PAST";

export type CommunityScheduleOccurrenceView = {
  state: ScheduleOccurrenceMaterializationState;
  runId?: string;
  blockedReason?: string;
  templateLabel?: string;
  autoCreateRun: boolean;
  canMaterialize: boolean;
};

export type CommunityScheduleProjectedSlot = {
  slot: CommunityScheduleSlotRecord;
  occurrence: ScheduleOccurrence;
  materialization: CommunityScheduleOccurrenceView;
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
  raidLeadId: string;
  label: string;
  usable: boolean;
  unusableReason: string | null;
  /** Authoritative RunTemplate fields for in-schedule Edit Run Setup. */
  name: string;
  contentPreset: RunContentPresetKey;
  venomousPlannedBossCount: number;
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
  /** Hard-delete allowed only when this slot has never materialized a Run. */
  canDelete: boolean;
  deleteBlockedReason: string | null;
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
  /** Hard-delete Run Setup + all its slots when none have materialization history. */
  canDelete: boolean;
  deleteBlockedReason: string | null;
};

export type CommunityScheduleContentPresetOption = {
  key: RunContentPresetKey;
  displayName: string;
};

export type CommunitySchedulePage = {
  canEdit: boolean;
  timeZone: string;
  current: CommunityScheduleWindowView;
  next: CommunityScheduleWindowView;
  slots: CommunityScheduleSlotRecord[];
  runSetups: CommunityScheduleRunSetupGroup[];
  eligibleRaidLeads: Array<{ id: string; name: string }>;
  templates: CommunityScheduleTemplateOption[];
  contentPresets: CommunityScheduleContentPresetOption[];
  venomousBossMax: number;
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

function templateProductFields(template: RunTemplateRecord): {
  contentPreset: RunContentPresetKey;
  venomousPlannedBossCount: number;
  productLabel: string;
  titleCoverage: string;
} {
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
  const productKey = classifyRunContents(contentRows);
  const coverage = templateCoverage(template);
  const display = templateContentDisplay(template);
  const venomousRow = contentRows.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID) ?? contentRows[0];
  return {
    contentPreset: productKey === "MIDNIGHT_S2_BUNDLE" ? "MIDNIGHT_S2_BUNDLE" : "VENOMOUS_ABYSS",
    venomousPlannedBossCount: Math.min(
      8,
      Math.max(1, venomousRow?.plannedBossCount ?? template.plannedBossCount),
    ),
    productLabel: display.productLabel,
    titleCoverage: coverage.titleCoverage,
  };
}

async function validateTemplateLink(input: {
  raidLeadId: string;
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
  if (template.raidLeadId !== input.raidLeadId) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_LEAD_MISMATCH",
      "The run setup must belong to the selected raid lead.",
      400,
    );
  }
  const usability = computeUsability(template);
  if (input.autoCreateRun && !usability.usable) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      usability.unusableReason ?? "This run setup is not usable for auto-create.",
      400,
    );
  }
  return template;
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
  materializedSlotIds: ReadonlySet<string>,
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
        canDelete: false,
        deleteBlockedReason: null,
      };
      groups.set(key, group);
    }
    const slotCanDelete = canEdit && !materializedSlotIds.has(slot.id);
    group.slots.push({
      id: slot.id,
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      isActive: slot.isActive,
      autoCreateRun: slot.autoCreateRun,
      runMode: slot.runMode,
      label: slot.label,
      notes: slot.notes,
      canDelete: slotCanDelete,
      deleteBlockedReason: slotCanDelete
        ? null
        : canEdit
          ? "Cannot delete — this time has already created a Run."
          : null,
    });
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.slots.sort(compareSetupSlots);
    group.slotCount = group.slots.length;
    group.autoCreateSummary = autoCreateSummary(group.slots);
    if (!canEdit || !group.runTemplateId) {
      group.canDelete = false;
      group.deleteBlockedReason = null;
    } else if (group.slots.some((slot) => !slot.canDelete)) {
      group.canDelete = false;
      group.deleteBlockedReason =
        "Cannot delete — one or more times have already created a Run.";
    } else {
      group.canDelete = true;
      group.deleteBlockedReason = null;
    }
  }
  result.sort((a, b) => {
    const byName = a.runSetupName.localeCompare(b.runSetupName);
    if (byName !== 0) return byName;
    return a.raidLeadName.localeCompare(b.raidLeadName);
  });
  return result;
}

function buildMaterializationView(input: {
  user: AuthenticatedUser;
  slot: CommunityScheduleSlotRecord;
  occurrence: ScheduleOccurrence;
  linkRunId: string | null;
  templateLabel: string | null;
  templateUsable: boolean | null;
  templateUnusableReason: string | null;
  now: Date;
}): CommunityScheduleOccurrenceView {
  const { slot, occurrence, user, now } = input;
  const autoCreateRun = slot.autoCreateRun;
  const canMaterialize =
    slot.isActive &&
    slot.runTemplateId != null &&
    canMaterializeCommunityScheduleOccurrence(user, slot) &&
    (input.templateUsable ?? false);

  if (Date.parse(occurrence.scheduledStartAt) < now.getTime()) {
    if (input.linkRunId) {
      return {
        state: "RUN_CREATED",
        runId: input.linkRunId,
        templateLabel: input.templateLabel ?? undefined,
        autoCreateRun,
        canMaterialize: false,
      };
    }
    return {
      state: "PAST",
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
    };
  }

  if (input.linkRunId) {
    return {
      state: "RUN_CREATED",
      runId: input.linkRunId,
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
    };
  }

  if (!slot.runTemplateId) {
    return {
      state: "NO_RUN_YET",
      autoCreateRun,
      canMaterialize: false,
    };
  }

  if (autoCreateRun) {
    if (input.templateUsable) {
      return {
        state: "AUTO_WAITING",
        templateLabel: input.templateLabel ?? undefined,
        autoCreateRun,
        canMaterialize,
      };
    }
    return {
      state: "AUTO_BLOCKED",
      blockedReason: input.templateUnusableReason ?? "Run Setup is not usable.",
      templateLabel: input.templateLabel ?? undefined,
      autoCreateRun,
      canMaterialize: false,
    };
  }

  return {
    state: "NO_RUN_YET",
    templateLabel: input.templateLabel ?? undefined,
    autoCreateRun,
    canMaterialize,
  };
}

function projectWindow(
  user: AuthenticatedUser,
  slots: CommunityScheduleSlotRecord[],
  window: RaidIdWindow,
  now: Date,
  linksByKey: Map<string, string>,
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
    const linkRunId = linksByKey.get(linkKey) ?? null;
    const templateMeta = slot.runTemplateId ? templateMetaById.get(slot.runTemplateId) : null;

    projected.push({
      slot,
      occurrence,
      materialization: buildMaterializationView({
        user,
        slot,
        occurrence,
        linkRunId,
        templateLabel: templateMeta?.label ?? slot.runTemplateName,
        templateUsable: templateMeta?.usable ?? null,
        templateUnusableReason: templateMeta?.unusableReason ?? null,
        now,
      }),
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

async function listTemplateOptions(user: AuthenticatedUser): Promise<{
  options: CommunityScheduleTemplateOption[];
  recordsById: Map<string, RunTemplateRecord>;
}> {
  const templates = hasAdminAccess(user.accountRole)
    ? await runTemplateRepository.listAll()
    : await runTemplateRepository.listByRaidLead(user.id);

  const recordsById = new Map(templates.map((template) => [template.id, template]));
  const options = templates.map((template) => {
    const usability = computeUsability(template);
    const product = templateProductFields(template);
    return {
      id: template.id,
      raidLeadId: template.raidLeadId,
      label: templateLabel(template),
      usable: usability.usable,
      unusableReason: usability.unusableReason,
      name: template.name,
      contentPreset: product.contentPreset,
      venomousPlannedBossCount: product.venomousPlannedBossCount,
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
  return { options, recordsById };
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
  }>;
  label: string;
  notes: string | null;
  raidLeadId: string;
  runTemplateId: string;
  autoCreateRun: boolean;
  actorId: string;
}): Promise<string[]> {
  const slotIds: string[] = [];
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
        createdById: input.actorId,
        updatedById: input.actorId,
      },
      input.txOrm,
    );
    slotIds.push(created.id);
  }
  return slotIds;
}

async function maybeImmediateMaterialize(
  slotIds: ReadonlyArray<string>,
  autoCreateRun: boolean,
  now?: Date,
): Promise<ScheduleMutationMaterialization> {
  if (!autoCreateRun || slotIds.length === 0) {
    return { created: 0, failed: 0, warning: null };
  }
  try {
    const result = await communityScheduleMaterializationService.materializeSlotWindows(slotIds, {
      now,
    });
    return summarizeMaterialization(result);
  } catch {
    return {
      created: 0,
      failed: slotIds.length,
      warning: COMMUNITY_SCHEDULE_MATERIALIZE_WARNING,
    };
  }
}

function summarizeMaterialization(result: MaterializeSlotWindowsResult): ScheduleMutationMaterialization {
  return {
    created: result.created,
    failed: result.failed,
    warning: result.failed > 0 ? COMMUNITY_SCHEDULE_MATERIALIZE_WARNING : null,
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

    const { options: templates, recordsById: templatesById } = templateBundle;

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
    const linksByKey = new Map<string, string>();
    const materializedSlotIds = new Set<string>();
    for (const link of links) {
      linksByKey.set(`${link.scheduleSlotId}\0${link.windowStartAt}`, link.runId);
      materializedSlotIds.add(link.scheduleSlotId);
    }

    const visibleSlots = canEdit ? slots : slots.filter((slot) => slot.isActive);

    return {
      canEdit,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      current: projectWindow(user, slots, "CURRENT", now, linksByKey, templateMetaById),
      next: projectWindow(user, slots, "NEXT", now, linksByKey, templateMetaById),
      slots: visibleSlots,
      runSetups: groupRunSetups(visibleSlots, canEdit, templatesById, materializedSlotIds),
      eligibleRaidLeads: eligibleRaidLeads.map((lead) => ({ id: lead.id, name: lead.name })),
      templates: canEdit
        ? templates
        : templates.filter((row) => row.usable && row.raidLeadId === user.id),
      contentPresets: listCreateRunContentPresets(),
      venomousBossMax: venomousBossMaxFromCatalog(),
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
  ): Promise<ScheduleMutationResult<{ templateId: string; slotIds: string[] }>> {
    requireManage(user);
    assertBatchSlotLimits(input.slots);
    await requireEligibleRaidLead(input.raidLeadId);
    await assertNoConflictsForLead(input.raidLeadId, input.slots);

    let templateId: string;
    let templateName: string;

    if (input.runSetup.mode === "existing") {
      const template = await validateTemplateLink({
        raidLeadId: input.raidLeadId,
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
      templateName = input.runSetup.name.trim();
    }

    const result = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      let resolvedTemplateId = templateId;
      let resolvedName = templateName;

      if (input.runSetup.mode === "create") {
        const created = await runTemplateService.createTemplateInTx(
          user,
          {
            ...input.runSetup,
            raidLeadId: input.raidLeadId,
          },
          txOrm,
        );
        resolvedTemplateId = created.id;
        resolvedName = input.runSetup.name.trim();
      }

      const slotIds = await createSlotsInTx({
        txOrm,
        slots: input.slots,
        label: resolvedName,
        notes: input.notes,
        raidLeadId: input.raidLeadId,
        runTemplateId: resolvedTemplateId,
        autoCreateRun: input.autoCreateRun,
        actorId: user.id,
      });

      return { templateId: resolvedTemplateId, slotIds };
    });

    const materialization = await maybeImmediateMaterialize(result.slotIds, input.autoCreateRun, now);
    return { ...result, materialization };
  },

  async addTimesToSetup(
    user: AuthenticatedUser,
    input: AddScheduleTimesInput,
    now?: Date,
  ): Promise<ScheduleMutationResult<{ templateId: string; slotIds: string[] }>> {
    requireManage(user);
    assertBatchSlotLimits(input.slots);
    await requireEligibleRaidLead(input.raidLeadId);

    const template = await validateTemplateLink({
      raidLeadId: input.raidLeadId,
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
    if (template.raidLeadId !== input.raidLeadId) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_TEMPLATE_LEAD_MISMATCH",
        "The run setup must belong to the selected raid lead.",
        400,
      );
    }

    await assertNoConflictsForLead(input.raidLeadId, input.slots);

    const slotIds = await db.transaction(async (tx) => {
      const txOrm = resolveTxOrm(tx);
      return createSlotsInTx({
        txOrm,
        slots: input.slots,
        label: template.name,
        notes: input.notes,
        raidLeadId: input.raidLeadId,
        runTemplateId: template.id,
        autoCreateRun: input.autoCreateRun,
        actorId: user.id,
      });
    });

    const materialization = await maybeImmediateMaterialize(slotIds, input.autoCreateRun, now);
    return { templateId: template.id, slotIds, materialization };
  },

  async createSlot(
    user: AuthenticatedUser,
    input: CreateCommunityScheduleSlotInput,
    now?: Date,
  ): Promise<ScheduleMutationResult<{ slot: CommunityScheduleSlotRecord }>> {
    requireManage(user);
    await requireEligibleRaidLead(input.raidLeadId);
    await validateTemplateLink({
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
    });
    await assertNoDuplicate({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
    });
    const slot = await communityScheduleRepository.create({
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      runMode: input.runMode,
      createdById: user.id,
      updatedById: user.id,
    });
    const materialization = await maybeImmediateMaterialize([slot.id], slot.autoCreateRun, now);
    return { slot, materialization };
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
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
    });
    await assertNoDuplicate({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      excludeId: input.slotId,
    });
    const slot = await communityScheduleRepository.update(input.slotId, {
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      runMode: input.runMode,
      updatedById: user.id,
    });
    const materialization = await maybeImmediateMaterialize([slot.id], slot.autoCreateRun, now);
    return { slot, materialization };
  },

  async deactivateSlot(user: AuthenticatedUser, slotId: string): Promise<CommunityScheduleSlotRecord> {
    requireManage(user);
    const existing = await communityScheduleRepository.findById(slotId);
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
    return communityScheduleRepository.setActive(slotId, false, user.id);
  },

  async reactivateSlot(
    user: AuthenticatedUser,
    slotId: string,
  ): Promise<ScheduleMutationResult<{ slot: CommunityScheduleSlotRecord }>> {
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
    const slot = await communityScheduleRepository.setActive(slotId, true, user.id);
    const materialization = await maybeImmediateMaterialize([slot.id], slot.autoCreateRun);
    return { slot, materialization };
  },

  /**
   * Hard-delete a Schedule time that has never materialized a Run.
   * Active/inactive unused slots are both allowed. History is protected by
   * CommunityScheduleRun Restrict FK + an in-transaction existence check.
   */
  async deleteSlot(user: AuthenticatedUser, slotId: string): Promise<{ id: string }> {
    requireManage(user);
    try {
      await db.transaction(async (tx) => {
        const txOrm = resolveTxOrm(tx);
        const existing = await communityScheduleRepository.findById(slotId, txOrm);
        if (!existing) {
          throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
        }
        const materialized = await communityScheduleRunRepository.slotIdsWithMaterialization(
          [slotId],
          txOrm,
        );
        if (materialized.has(slotId)) {
          throw new DomainError(
            "COMMUNITY_SCHEDULE_DELETE_BLOCKED",
            SLOT_DELETE_BLOCKED_MESSAGE,
            409,
          );
        }
        await communityScheduleRepository.deleteById(slotId, txOrm);
      });
    } catch (error) {
      if (isDomainError(error)) throw error;
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          "COMMUNITY_SCHEDULE_DELETE_BLOCKED",
          SLOT_DELETE_BLOCKED_MESSAGE,
          409,
        );
      }
      throw error;
    }
    return { id: slotId };
  },

  /**
   * Hard-delete an unused Run Setup and all of its never-materialized Schedule
   * times. Atomic: slots + template (+ cascaded contents) or nothing.
   */
  async deleteRunSetup(
    user: AuthenticatedUser,
    runTemplateId: string,
  ): Promise<{ id: string; deletedSlotCount: number }> {
    requireManage(user);
    let deletedSlotCount = 0;
    try {
      await db.transaction(async (tx) => {
        const txOrm = resolveTxOrm(tx);
        const template = await runTemplateRepository.findById(runTemplateId, txOrm);
        if (!template) {
          throw new DomainError("RUN_TEMPLATE_NOT_FOUND", "Run Setup was not found.", 404);
        }

        const slots = await communityScheduleRepository.listByTemplateId(runTemplateId, txOrm);
        const slotIds = slots.map((slot) => slot.id);
        if (slotIds.length > 0) {
          const materialized = await communityScheduleRunRepository.slotIdsWithMaterialization(
            slotIds,
            txOrm,
          );
          if (materialized.size > 0) {
            throw new DomainError(
              "COMMUNITY_SCHEDULE_SETUP_DELETE_BLOCKED",
              SETUP_DELETE_BLOCKED_MESSAGE,
              409,
            );
          }
          for (const slotId of slotIds) {
            await communityScheduleRepository.deleteById(slotId, txOrm);
          }
        }
        deletedSlotCount = slotIds.length;
        await runTemplateRepository.deleteById(runTemplateId, txOrm);
      });
    } catch (error) {
      if (isDomainError(error)) throw error;
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          "COMMUNITY_SCHEDULE_SETUP_DELETE_BLOCKED",
          SETUP_DELETE_BLOCKED_MESSAGE,
          409,
        );
      }
      throw error;
    }
    return { id: runTemplateId, deletedSlotCount };
  },
};
