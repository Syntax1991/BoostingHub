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
  compareScheduleOccurrences,
  resolveScheduleSlotOccurrence,
  type RaidIdWindow,
  type ScheduleOccurrence,
} from "@/lib/community-schedule";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { DomainError } from "@/lib/errors";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { userRepository } from "@/repositories/user.repository";
import { computeUsability } from "@/services/run-template.service";
import type {
  CreateCommunityScheduleSlotInput,
  UpdateCommunityScheduleSlotInput,
} from "@/validators/community-schedule";

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

export type CommunitySchedulePage = {
  canEdit: boolean;
  timeZone: string;
  current: CommunityScheduleWindowView;
  next: CommunityScheduleWindowView;
  slots: CommunityScheduleSlotRecord[];
  eligibleRaidLeads: Array<{ id: string; name: string }>;
  templates: CommunityScheduleTemplateOption[];
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
      "This raid lead already has a schedule slot at that weekday and time.",
      409,
    );
  }
}

function templateLabel(template: RunTemplateRecord): string {
  return `${template.name} · ${DIFFICULTY_ABBREVIATIONS[template.difficulty]} ${RUN_LOOT_TYPE_LABELS[template.lootType]} ${template.plannedBossCount}/${template.totalBossCount}`;
}

async function validateTemplateLink(input: {
  raidLeadId: string;
  runTemplateId: string | null;
  autoCreateRun: boolean;
}): Promise<void> {
  if (input.autoCreateRun && !input.runTemplateId) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_REQUIRED",
      "Choose a run template when auto-create is enabled.",
      400,
    );
  }
  if (!input.runTemplateId) {
    return;
  }
  const template = await runTemplateRepository.findById(input.runTemplateId);
  if (!template) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      "Choose a valid run template.",
      400,
    );
  }
  if (template.raidLeadId !== input.raidLeadId) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_LEAD_MISMATCH",
      "The run template must belong to the selected raid lead.",
      400,
    );
  }
  const usability = computeUsability(template);
  if (input.autoCreateRun && !usability.usable) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      usability.unusableReason ?? "This template is not usable for auto-create.",
      400,
    );
  }
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
      blockedReason: input.templateUnusableReason ?? "Template is not usable.",
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

/**
 * Community Weekly Schedule — recurring planning intent with optional DRAFT Run
 * materialization per raid-ID window. Never auto-opens Runs or Discord state.
 */
export const communityScheduleService = {
  async getPage(user: AuthenticatedUser, now = new Date()): Promise<CommunitySchedulePage> {
    requireView(user);
    const canEdit = canManageCommunitySchedule(user.accountRole);
    const [slots, eligibleRaidLeads, templates] = await Promise.all([
      communityScheduleRepository.listAll(),
      canEdit ? userRepository.listEligibleRaidLeads() : Promise.resolve([]),
      listTemplateOptions(user),
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

    return {
      canEdit,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      current: projectWindow(user, slots, "CURRENT", now, linksByKey, templateMetaById),
      next: projectWindow(user, slots, "NEXT", now, linksByKey, templateMetaById),
      slots: canEdit ? slots : slots.filter((slot) => slot.isActive),
      eligibleRaidLeads: eligibleRaidLeads.map((lead) => ({ id: lead.id, name: lead.name })),
      templates: canEdit
        ? templates.filter((row) => row.usable)
        : templates.filter((row) => row.usable && row.raidLeadId === user.id),
    };
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
