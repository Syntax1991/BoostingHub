import { orm } from "@/lib/prisma";
import type { RaidDifficulty, RunLootType } from "@/models/enums";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapDifficulty,
  mapLootType,
} from "@/lib/persistence";

/**
 * A joined, current-state read of a global RunTemplate.
 * Raid identity lives on ordered `contents` (RunTemplateRaidContent).
 */
export type RunTemplateContentRecord = {
  id: string;
  raidId: string;
  raidName: string;
  raidSeason: string;
  raidAvailableForRuns: boolean;
  sortOrder: number;
  plannedBossCount: number;
  totalBossCount: number;
};

export type RunTemplateRecord = {
  id: string;
  name: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  contents: RunTemplateContentRecord[];
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  notes: string | null;
  isActive: boolean;
  createdById: string;
  createdByName: string;
  updatedById: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type RunTemplateContentWriteSpec = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

export type CreateRunTemplateFields = {
  name: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  contents: RunTemplateContentWriteSpec[];
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  /** Omitted → 0 on create, unchanged on update. */
  desiredLootbuddyCount?: number;
  notes: string | null;
  createdById: string;
  updatedById: string;
};

export type UpdateRunTemplateFields = {
  name: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  contents: RunTemplateContentWriteSpec[];
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  /** Omitted → 0 on create, unchanged on update. */
  desiredLootbuddyCount?: number;
  notes: string | null;
  updatedById: string;
};

function mapContentRow(row: Record<string, unknown>): RunTemplateContentRecord {
  const raid = (row.raid ?? {}) as Record<string, unknown>;
  const bosses = Array.isArray(raid.bosses) ? raid.bosses : [];
  return {
    id: asString(row.id),
    raidId: asString(row.raidId ?? raid.id),
    raidName: asString(raid.name, "Unknown raid"),
    raidSeason: asString(raid.season),
    raidAvailableForRuns: asBoolean(raid.isActive, true),
    sortOrder: asNumber(row.sortOrder),
    plannedBossCount: asNumber(row.plannedBossCount),
    totalBossCount: bosses.length,
  };
}

function mapTemplate(row: Record<string, unknown>): RunTemplateRecord {
  const createdBy = (row.createdBy ?? {}) as Record<string, unknown>;
  const updatedBy = (row.updatedBy ?? {}) as Record<string, unknown>;
  const contentRows = Array.isArray(row.contents) ? row.contents : [];
  const contents = contentRows
    .map((content) => mapContentRow(content as Record<string, unknown>))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (contents.length === 0) {
    throw new Error(`RunTemplate ${asString(row.id)} has no content rows.`);
  }

  return {
    id: asString(row.id),
    name: asString(row.name),
    difficulty: mapDifficulty(row.difficulty),
    lootType: mapLootType(row.lootType),
    contents,
    desiredTankCount: asNumber(row.desiredTankCount),
    desiredHealerCount: asNumber(row.desiredHealerCount),
    desiredDpsCount: asNumber(row.desiredDpsCount),
    desiredLootbuddyCount: asNumber(row.desiredLootbuddyCount),
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

async function insertTemplateContents(
  client: TxOrm,
  runTemplateId: string,
  contents: RunTemplateContentWriteSpec[],
  now: string,
): Promise<void> {
  if (contents.length === 0) {
    throw new Error("RunTemplate must include at least one content row.");
  }
  const sorted = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const content of sorted) {
    await client.RunTemplateRaidContent.create({
      id: crypto.randomUUID(),
      runTemplateId,
      raidId: content.raidId,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      createdAt: now,
    });
  }
}

async function replaceTemplateContents(
  client: TxOrm,
  runTemplateId: string,
  contents: RunTemplateContentWriteSpec[],
  now: string,
): Promise<void> {
  const existing = (await client.RunTemplateRaidContent.where({ runTemplateId }).all()) as Record<
    string,
    unknown
  >[];
  for (const row of existing) {
    await client.RunTemplateRaidContent.where({ id: asString(row.id) }).delete();
  }
  await insertTemplateContents(client, runTemplateId, contents, now);
}

/**
 * Persistence, scoped reads, relations, and mutations only — no role
 * authorization and no Run-planning business rules. Those live in
 * run-template.service.ts, which is the only caller.
 */
type TxOrm = typeof orm;

export const runTemplateRepository = {
  async findById(id: string, txOrm?: TxOrm): Promise<RunTemplateRecord | null> {
    const client = txOrm ?? orm;
    const row = await client.RunTemplate.where({ id })
      .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses")))
      .include("createdBy")
      .include("updatedBy")
      .first();
    return row ? mapTemplate(row as Record<string, unknown>) : null;
  },

  async listAll(): Promise<RunTemplateRecord[]> {
    const rows = await orm.RunTemplate.include("contents", (content) =>
      content.include("raid", (raid) => raid.include("bosses")),
    )
      .include("createdBy")
      .include("updatedBy")
      .orderBy((template) => template.name.asc())
      .all();
    return rows.map((row) => mapTemplate(row as Record<string, unknown>));
  },

  async create(fields: CreateRunTemplateFields, txOrm?: TxOrm): Promise<string> {
    const client = txOrm ?? orm;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.RunTemplate.create({
      id,
      name: fields.name,
      difficulty: fields.difficulty,
      lootType: fields.lootType,
      desiredTankCount: fields.desiredTankCount,
      desiredHealerCount: fields.desiredHealerCount,
      desiredDpsCount: fields.desiredDpsCount,
      desiredLootbuddyCount: fields.desiredLootbuddyCount ?? 0,
      notes: fields.notes,
      isActive: true,
      createdById: fields.createdById,
      updatedById: fields.updatedById,
      createdAt: now,
      updatedAt: now,
    });
    await insertTemplateContents(client, id, fields.contents, now);
    return id;
  },

  async update(id: string, fields: UpdateRunTemplateFields, txOrm?: TxOrm): Promise<void> {
    const client = txOrm ?? orm;
    const now = new Date().toISOString();
    await client.RunTemplate.where({ id }).update({
      name: fields.name,
      difficulty: fields.difficulty,
      lootType: fields.lootType,
      desiredTankCount: fields.desiredTankCount,
      desiredHealerCount: fields.desiredHealerCount,
      desiredDpsCount: fields.desiredDpsCount,
      ...(fields.desiredLootbuddyCount !== undefined
        ? { desiredLootbuddyCount: fields.desiredLootbuddyCount }
        : {}),
      notes: fields.notes,
      updatedById: fields.updatedById,
      updatedAt: now,
    });
    await replaceTemplateContents(client, id, fields.contents, now);
  },

  async setActive(id: string, isActive: boolean, updatedById: string): Promise<void> {
    await orm.RunTemplate.where({ id }).update({
      isActive,
      updatedById,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Hard-delete a RunTemplate. RunTemplateRaidContent rows cascade via FK.
   * Callers must remove referencing CommunityScheduleSlots first (Restrict).
   */
  async deleteById(id: string, txOrm?: TxOrm): Promise<void> {
    const client = txOrm ?? orm;
    await client.RunTemplate.where({ id }).delete();
  },
};
