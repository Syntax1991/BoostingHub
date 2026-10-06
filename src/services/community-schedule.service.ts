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
import { DomainError } from "@/lib/errors";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { db, orm } from "@/lib/prisma";
import { COMMUNITY_WEEKDAYS, type CommunityWeekday } from "@/models/enums";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { userRepository } from "@/repositories/user.repository";
import { computeUsability, runTemplateService } from "@/services/run-template.service";
import type {
  AddScheduleTimesInput,
  CreateCommunityScheduleSlotInput,
  CreateSchedulePlanInput,
  UpdateCommunityScheduleSlotInput,
} from "@/validators/community-schedule";

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
};

export type CommunityScheduleRunSetupSlot = {
  id: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  isActive: boolean;
  autoCreateRun: boolean;
  label: string;
  notes: string | null;
};

export type CommunityScheduleRunSetupGroup = {
  key: string;
  runTemplateId: string | null;
  runSetupName: string;
  raidLeadId: string;
  raidLeadName: string;
  slots: CommunityScheduleRunSetupSlot[];
  autoCreateSummary: "ON" | "OFF" | "MIXED";
  canEdit: boolean;
};

export type CommunityScheduleRaidOption = {
  id: string;
  name: string;
  season: string;
  totalBossCount: number;
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
  raids: CommunityScheduleRaidOption[];
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
  return `${template.name} · ${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} ${template.plannedBossCount}/${template.totalBossCount}`;
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
): CommunityScheduleRunSetupGroup[] {
  const groups = new Map<string, CommunityScheduleRunSetupGroup>();
  for (const slot of slots) {
    const key = `${slot.runTemplateId ?? "none"}:${slot.raidLeadId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        runTemplateId: slot.runTemplateId,
        runSetupName: slot.runTemplateName ?? "Unconfigured Schedule",
        raidLeadId: slot.raidLeadId,
        raidLeadName: slot.raidLeadName,
        slots: [],
        autoCreateSummary: "OFF",
        canEdit,
      };
      groups.set(key, group);
    }
    group.slots.push({
      id: slot.id,
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      isActive: slot.isActive,
      autoCreateRun: slot.autoCreateRun,
      label: slot.label,
      notes: slot.notes,
    });
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.slots.sort(compareSetupSlots);
    group.autoCreateSummary = autoCreateSummary(group.slots);
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

async function listTemplateOptions(user: AuthenticatedUser): Promise<CommunityScheduleTemplateOption[]> {
  const templates = hasAdminAccess(user.accountRole)
    ? await runTemplateRepository.listAll()
    : await runTemplateRepository.listByRaidLead(user.id);

  return templates.map((template) => {
    const usability = computeUsability(template);
    return {
      id: template.id,
      raidLeadId: template.raidLeadId,
      label: templateLabel(template),
      usable: usability.usable,
      unusableReason: usability.unusableReason,
    };
  });
}

function resolveTxOrm(tx: { orm: unknown }): TxOrm {
  return ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
}

async function createSlotsInTx(input: {
  txOrm: TxOrm;
  slots: ReadonlyArray<{ weekday: CommunityWeekday; localStartTime: string }>;
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
        createdById: input.actorId,
        updatedById: input.actorId,
      },
      input.txOrm,
    );
    slotIds.push(created.id);
  }
  return slotIds;
}

/**
 * Community Weekly Schedule — recurring planning intent with optional DRAFT Run
 * materialization per raid-ID window. Never auto-opens Runs or Discord state.
 */
export const communityScheduleService = {
  async getPage(user: AuthenticatedUser, now = new Date()): Promise<CommunitySchedulePage> {
    requireView(user);
    const canEdit = canManageCommunitySchedule(user.accountRole);
    const [slots, eligibleRaidLeads, templates, raids] = await Promise.all([
      communityScheduleRepository.listAll(),
      canEdit ? userRepository.listEligibleRaidLeads() : Promise.resolve([]),
      listTemplateOptions(user),
      canEdit
        ? raidRepository.ensureReferenceRaids().then(() => raidRepository.listAvailableForRuns())
        : Promise.resolve([]),
    ]);

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

    const links = await communityScheduleRunRepository.listBySlotIds(slots.map((slot) => slot.id));
    const linksByKey = new Map<string, string>();
    for (const link of links) {
      linksByKey.set(`${link.scheduleSlotId}\0${link.windowStartAt}`, link.runId);
    }

    const visibleSlots = canEdit ? slots : slots.filter((slot) => slot.isActive);

    return {
      canEdit,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      current: projectWindow(user, slots, "CURRENT", now, linksByKey, templateMetaById),
      next: projectWindow(user, slots, "NEXT", now, linksByKey, templateMetaById),
      slots: visibleSlots,
      runSetups: groupRunSetups(visibleSlots, canEdit),
      eligibleRaidLeads: eligibleRaidLeads.map((lead) => ({ id: lead.id, name: lead.name })),
      templates: canEdit
        ? templates.filter((row) => row.usable)
        : templates.filter((row) => row.usable && row.raidLeadId === user.id),
      raids: raids.map((raid) => ({
        id: raid.id,
        name: raid.name,
        season: raid.season,
        totalBossCount: raid.totalBossCount,
      })),
    };
  },

  async createSchedulePlan(
    user: AuthenticatedUser,
    input: CreateSchedulePlanInput,
  ): Promise<{ templateId: string; slotIds: string[] }> {
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

    return result;
  },

  async addTimesToSetup(
    user: AuthenticatedUser,
    input: AddScheduleTimesInput,
  ): Promise<{ templateId: string; slotIds: string[] }> {
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

    return { templateId: template.id, slotIds };
  },

  async createSlot(
    user: AuthenticatedUser,
    input: CreateCommunityScheduleSlotInput,
  ): Promise<CommunityScheduleSlotRecord> {
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
    return communityScheduleRepository.create({
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      createdById: user.id,
      updatedById: user.id,
    });
  },

  async updateSlot(
    user: AuthenticatedUser,
    input: UpdateCommunityScheduleSlotInput,
  ): Promise<CommunityScheduleSlotRecord> {
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
    return communityScheduleRepository.update(input.slotId, {
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      updatedById: user.id,
    });
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

  async reactivateSlot(user: AuthenticatedUser, slotId: string): Promise<CommunityScheduleSlotRecord> {
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
    return communityScheduleRepository.setActive(slotId, true, user.id);
  },
};
