import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageCommunitySchedule,
  canViewCommunitySchedule,
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
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { userRepository } from "@/repositories/user.repository";
import type {
  CreateCommunityScheduleSlotInput,
  UpdateCommunityScheduleSlotInput,
} from "@/validators/community-schedule";

export type CommunityScheduleProjectedSlot = {
  slot: CommunityScheduleSlotRecord;
  occurrence: ScheduleOccurrence;
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

export type CommunitySchedulePage = {
  canEdit: boolean;
  timeZone: string;
  current: CommunityScheduleWindowView;
  next: CommunityScheduleWindowView;
  /** All slots including inactive — ADMIN management list. RAID_LEAD sees active only in windows. */
  slots: CommunityScheduleSlotRecord[];
  eligibleRaidLeads: Array<{ id: string; name: string }>;
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

function projectWindow(
  slots: CommunityScheduleSlotRecord[],
  window: RaidIdWindow,
  now: Date,
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
    projected.push({ slot, occurrence });
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

/**
 * Community Weekly Schedule — planning intent only.
 * Never creates/mutates Runs or Discord state.
 */
export const communityScheduleService = {
  async getPage(user: AuthenticatedUser, now = new Date()): Promise<CommunitySchedulePage> {
    requireView(user);
    const canEdit = canManageCommunitySchedule(user.accountRole);
    const [slots, eligibleRaidLeads] = await Promise.all([
      communityScheduleRepository.listAll(),
      canEdit ? userRepository.listEligibleRaidLeads() : Promise.resolve([]),
    ]);

    return {
      canEdit,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      current: projectWindow(slots, "CURRENT", now),
      next: projectWindow(slots, "NEXT", now),
      slots: canEdit ? slots : slots.filter((slot) => slot.isActive),
      eligibleRaidLeads: eligibleRaidLeads.map((lead) => ({ id: lead.id, name: lead.name })),
    };
  },

  async createSlot(
    user: AuthenticatedUser,
    input: CreateCommunityScheduleSlotInput,
  ): Promise<CommunityScheduleSlotRecord> {
    requireManage(user);
    await requireEligibleRaidLead(input.raidLeadId);
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
    await assertNoDuplicate({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      excludeId: input.slotId,
    });
    // Snapshot independence: only the schedule row is updated — never Runs.
    return communityScheduleRepository.update(input.slotId, {
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
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
    // Snapshot independence: deactivation never cancels Runs.
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
