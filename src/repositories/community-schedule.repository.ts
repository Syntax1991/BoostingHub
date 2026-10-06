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
  runTemplateId: string | null;
  autoCreateRun: boolean;
  runTemplateName: string | null;
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
  runTemplateId: string | null;
  autoCreateRun: boolean;
  createdById: string;
  updatedById: string;
};

export type CommunityScheduleSlotUpdate = {
  weekday: CommunityWeekday;
  localStartTime: string;
  label: string;
  notes: string | null;
  raidLeadId: string;
  runTemplateId: string | null;
  autoCreateRun: boolean;
  updatedById: string;
};

type TxOrm = typeof orm;

function mapSlot(row: Record<string, unknown>): CommunityScheduleSlotRecord {
  const raidLead = (row.raidLead ?? {}) as Record<string, unknown>;
  const runTemplate = row.runTemplate ? (row.runTemplate as Record<string, unknown>) : null;
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
    runTemplateId: asStringOrNull(row.runTemplateId),
    autoCreateRun: asBoolean(row.autoCreateRun, false),
    runTemplateName: runTemplate ? asString(runTemplate.name) : null,
    isActive: asBoolean(row.isActive, true),
    createdById: asString(row.createdById),
    updatedById: asString(row.updatedById),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

function baseSlotQuery(client: TxOrm = orm) {
  return client.CommunityScheduleSlot.include("raidLead").include("runTemplate");
}

export const communityScheduleRepository = {
  async listAll(): Promise<CommunityScheduleSlotRecord[]> {
    const rows = await baseSlotQuery()
      .orderBy((slot) => slot.weekday.asc())
      .orderBy((slot) => slot.localStartTime.asc())
      .orderBy((slot) => slot.id.asc())
      .all();
    return rows.map((row) => mapSlot(row as Record<string, unknown>));
  },

  async findById(id: string, txOrm?: TxOrm): Promise<CommunityScheduleSlotRecord | null> {
    const row = await baseSlotQuery(txOrm).where({ id }).first();
    return row ? mapSlot(row as Record<string, unknown>) : null;
  },

  async findDuplicate(input: {
    raidLeadId: string;
    weekday: CommunityWeekday;
    localStartTime: string;
    excludeId?: string;
  }): Promise<CommunityScheduleSlotRecord | null> {
    const rows = await baseSlotQuery()
      .where({
        raidLeadId: input.raidLeadId,
        weekday: input.weekday,
        localStartTime: input.localStartTime,
      })
      .all();
    const match = rows.find((row) => {
      const rowId = asString((row as Record<string, unknown>).id);
      return !input.excludeId || rowId !== input.excludeId;
    });
    return match ? mapSlot(match as Record<string, unknown>) : null;
  },

  async findDuplicatesForLead(
    raidLeadId: string,
    pairs: ReadonlyArray<{ weekday: CommunityWeekday; localStartTime: string }>,
  ): Promise<CommunityScheduleSlotRecord[]> {
    if (pairs.length === 0) return [];
    const rows = await baseSlotQuery().where({ raidLeadId }).all();
    const wanted = new Set(pairs.map((pair) => `${pair.weekday}\0${pair.localStartTime}`));
    return rows
      .map((row) => mapSlot(row as Record<string, unknown>))
      .filter((slot) => wanted.has(`${slot.weekday}\0${slot.localStartTime}`));
  },

  async listActiveAutoCreateSlots(): Promise<CommunityScheduleSlotRecord[]> {
    const rows = await baseSlotQuery()
      .where({ isActive: true, autoCreateRun: true })
      .orderBy((slot) => slot.weekday.asc())
      .orderBy((slot) => slot.localStartTime.asc())
      .all();
    return rows
      .map((row) => mapSlot(row as Record<string, unknown>))
      .filter((slot) => slot.runTemplateId != null);
  },

  async create(
    input: CommunityScheduleSlotWrite,
    txOrm?: TxOrm,
  ): Promise<CommunityScheduleSlotRecord> {
    const client = txOrm ?? orm;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.CommunityScheduleSlot.create({
      id,
      weekday: input.weekday,
      localStartTime: input.localStartTime,
      label: input.label,
      notes: input.notes,
      raidLeadId: input.raidLeadId,
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
      isActive: true,
      createdById: input.createdById,
      updatedById: input.updatedById,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(id, client);
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
      runTemplateId: input.runTemplateId,
      autoCreateRun: input.autoCreateRun,
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
