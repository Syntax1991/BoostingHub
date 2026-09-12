import { orm } from "@/lib/prisma";
import type { AccountStatus, RaidDifficulty, RunLootType } from "@/models/enums";
import { isEligibleRaidLead } from "@/auth/authorization";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapDifficulty,
  mapLootType,
  mapUserRole,
} from "@/lib/persistence";

/**
 * A joined, current-state read of a RunTemplate. `raidLeadEligible` and
 * `raidAvailableForRuns` are derived from the *current* joined User/Raid rows
 * on every read — never cached on the template row itself — so usability
 * (see run-template.service.ts's computeUsability) always reflects the
 * template owner's and raid's live state, not what was true when the
 * template was created.
 */
export type RunTemplateRecord = {
  id: string;
  name: string;
  raidLeadId: string;
  raidLeadName: string;
  raidLeadEligible: boolean;
  raidId: string;
  raidName: string;
  raidSeason: string;
  raidAvailableForRuns: boolean;
  totalBossCount: number;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  notes: string | null;
  isActive: boolean;
  createdById: string;
  createdByName: string;
  updatedById: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateRunTemplateFields = {
  name: string;
  raidLeadId: string;
  raidId: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  notes: string | null;
  createdById: string;
  updatedById: string;
};

export type UpdateRunTemplateFields = {
  name: string;
  raidLeadId: string;
  raidId: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  notes: string | null;
  updatedById: string;
};

function mapTemplate(row: Record<string, unknown>): RunTemplateRecord {
  const raidLead = (row.raidLead ?? {}) as Record<string, unknown>;
  const raid = (row.raid ?? {}) as Record<string, unknown>;
  const createdBy = (row.createdBy ?? {}) as Record<string, unknown>;
  const updatedBy = (row.updatedBy ?? {}) as Record<string, unknown>;
  const bosses = Array.isArray(raid.bosses) ? raid.bosses : [];

  return {
    id: asString(row.id),
    name: asString(row.name),
    raidLeadId: asString(row.raidLeadId ?? raidLead.id),
    raidLeadName: asString(raidLead.name, "Unknown raid lead"),
    raidLeadEligible: isEligibleRaidLead({
      accountRole: mapUserRole(raidLead.accountRole),
      accountStatus: (asString(raidLead.accountStatus, "ACTIVE") as AccountStatus),
    }),
    raidId: asString(row.raidId ?? raid.id),
    raidName: asString(raid.name, "Unknown raid"),
    raidSeason: asString(raid.season),
    raidAvailableForRuns: asBoolean(raid.isActive, true),
    totalBossCount: bosses.length,
    difficulty: mapDifficulty(row.difficulty),
    lootType: mapLootType(row.lootType),
    plannedBossCount: asNumber(row.plannedBossCount),
    desiredTankCount: asNumber(row.desiredTankCount),
    desiredHealerCount: asNumber(row.desiredHealerCount),
    desiredDpsCount: asNumber(row.desiredDpsCount),
    notes: asStringOrNull(row.notes),
    isActive: asBoolean(row.isActive, true),
    createdById: asString(row.createdById ?? createdBy.id),
    createdByName: asString(createdBy.name, "Unknown"),
    updatedById: asString(row.updatedById ?? updatedBy.id),
    updatedByName: asString(updatedBy.name, "Unknown"),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

/**
 * Persistence, scoped reads, relations, and mutations only — no role
 * authorization and no Run-planning business rules (raid availability,
 * owner eligibility, composition/loot-type/boss-count bounds). Those live in
 * run-template.service.ts, which is the only caller.
 */
export const runTemplateRepository = {
  async findById(id: string): Promise<RunTemplateRecord | null> {
    const row = await orm.RunTemplate
      .where({ id })
      .include("raidLead")
      .include("raid", (raid) => raid.include("bosses"))
      .include("createdBy")
      .include("updatedBy")
      .first();
    return row ? mapTemplate(row as Record<string, unknown>) : null;
  },

  async listByRaidLead(raidLeadId: string): Promise<RunTemplateRecord[]> {
    const rows = await orm.RunTemplate
      .where({ raidLeadId })
      .include("raidLead")
      .include("raid", (raid) => raid.include("bosses"))
      .include("createdBy")
      .include("updatedBy")
      .orderBy((template) => template.name.asc())
      .all();
    return rows.map((row) => mapTemplate(row as Record<string, unknown>));
  },

  async listAll(filters: { raidLeadId?: string } = {}): Promise<RunTemplateRecord[]> {
    let query = orm.RunTemplate
      .include("raidLead")
      .include("raid", (raid) => raid.include("bosses"))
      .include("createdBy")
      .include("updatedBy");
    if (filters.raidLeadId) {
      query = query.where({ raidLeadId: filters.raidLeadId });
    }
    const rows = await query.orderBy((template) => template.name.asc()).all();
    return rows.map((row) => mapTemplate(row as Record<string, unknown>));
  },

  async create(fields: CreateRunTemplateFields): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.RunTemplate.create({
      id,
      name: fields.name,
      raidLeadId: fields.raidLeadId,
      raidId: fields.raidId,
      difficulty: fields.difficulty,
      lootType: fields.lootType,
      plannedBossCount: fields.plannedBossCount,
      desiredTankCount: fields.desiredTankCount,
      desiredHealerCount: fields.desiredHealerCount,
      desiredDpsCount: fields.desiredDpsCount,
      notes: fields.notes,
      isActive: true,
      createdById: fields.createdById,
      updatedById: fields.updatedById,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },

  async update(id: string, fields: UpdateRunTemplateFields): Promise<void> {
    await orm.RunTemplate.where({ id }).update({
      name: fields.name,
      raidLeadId: fields.raidLeadId,
      raidId: fields.raidId,
      difficulty: fields.difficulty,
      lootType: fields.lootType,
      plannedBossCount: fields.plannedBossCount,
      desiredTankCount: fields.desiredTankCount,
      desiredHealerCount: fields.desiredHealerCount,
      desiredDpsCount: fields.desiredDpsCount,
      notes: fields.notes,
      updatedById: fields.updatedById,
      updatedAt: new Date().toISOString(),
    });
  },

  async setActive(id: string, isActive: boolean, updatedById: string): Promise<void> {
    await orm.RunTemplate.where({ id }).update({
      isActive,
      updatedById,
      updatedAt: new Date().toISOString(),
    });
  },
};
