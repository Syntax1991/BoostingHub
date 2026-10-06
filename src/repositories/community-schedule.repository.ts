import { isEligibleRaidLead } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import {
  asBoolean,
  asString,
  asStringOrNull,
  mapUserRole,
} from "@/lib/persistence";
import type { AccountStatus, CommunityWeekday } from "@/models/enums";

export type CommunityScheduleSlotRecord = {
  id: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  label: string;
  notes: string | null;
  raidLeadId: string;
  raidLeadName: string;
  raidLeadEligible: boolean;
  isActive: boolean;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityScheduleSlotWrite = {
  weekday: CommunityWeekday;
  localStartTime: string;
  label: string;
  notes: string | null;
  raidLeadId: string;
  createdById: string;
  updatedById: string;
};

export type CommunityScheduleSlotUpdate = {
  weekday: CommunityWeekday;
  localStartTime: string;
  label: string;
  notes: string | null;
  raidLeadId: string;
  updatedById: string;
};

function mapSlot(row: Record<string, unknown>): CommunityScheduleSlotRecord {
  const raidLead = (row.raidLead ?? {}) as Record<string, unknown>;
  return {
    id: asString(row.id),
    weekday: asString(row.weekday) as CommunityWeekday,
    localStartTime: asString(row.localStartTime),
    label: asString(row.label),
    notes: asStringOrNull(row.notes),
    raidLeadId: asString(row.raidLeadId ?? raidLead.id),
    raidLeadName: asString(raidLead.name, "Unknown raid lead"),
    raidLeadEligible: isEligibleRaidLead({
      accountRole: mapUserRole(raidLead.accountRole),
      accountStatus: asString(raidLead.accountStatus, "ACTIVE") as AccountStatus,
    }),
    isActive: asBoolean(row.isActive, true),
    createdById: asString(row.createdById),
    updatedById: asString(row.updatedById),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export const communityScheduleRepository = {
  async listAll(): Promise<CommunityScheduleSlotRecord[]> {
    const rows = await orm.CommunityScheduleSlot.include("raidLead")
      .orderBy((slot) => slot.weekday.asc())
      .orderBy((slot) => slot.localStartTime.asc())
      .orderBy((slot) => slot.id.asc())
      .all();
    return rows.map((row) => mapSlot(row as Record<string, unknown>));
  },

  async findById(id: string): Promise<CommunityScheduleSlotRecord | null> {
    const row = await orm.CommunityScheduleSlot.where({ id }).include("raidLead").first();
    return row ? mapSlot(row as Record<string, unknown>) : null;
  },

  async findDuplicate(input: {
    raidLeadId: string;
    weekday: CommunityWeekday;
    localStartTime: string;
    excludeId?: string;
  }): Promise<CommunityScheduleSlotRecord | null> {
    const rows = await orm.CommunityScheduleSlot.where({
      raidLeadId: input.raidLeadId,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
    })
      .include("raidLead")
      .all();
    const match = rows.find((row) => {
      const id = asString((row as Record<string, unknown>).id);
      return !input.excludeId || id !== input.excludeId;
    });
    return match ? mapSlot(match as Record<string, unknown>) : null;
  },

  async create(input: CommunityScheduleSlotWrite): Promise<CommunityScheduleSlotRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.CommunityScheduleSlot.create({
      id,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      isActive: true,
      createdById: input.createdById,
      updatedById: input.updatedById,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(id);
    if (!created) {
      throw new Error("Community schedule slot create failed.");
    }
    return created;
  },

  async update(id: string, input: CommunityScheduleSlotUpdate): Promise<CommunityScheduleSlotRecord> {
    await orm.CommunityScheduleSlot.where({ id }).update({
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      updatedById: input.updatedById,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error("Community schedule slot update failed.");
    }
    return updated;
  },

  async setActive(
    id: string,
    isActive: boolean,
    updatedById: string,
  ): Promise<CommunityScheduleSlotRecord> {
    await orm.CommunityScheduleSlot.where({ id }).update({
      isActive,
      updatedById,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error("Community schedule slot setActive failed.");
    }
    return updated;
  },
};
