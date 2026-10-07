import { orm } from "@/lib/prisma";
import { asIsoTimestamp, asString, mapRunDomainEventActorKind } from "@/lib/persistence";
import type { RunDomainEventActorKind } from "@/models/enums";

export type CommunityScheduleRunRecord = {
  id: string;
  /** Null after the mutable Schedule slot was deleted (ON DELETE SET NULL). */
  scheduleSlotId: string | null;
  windowStartAt: string;
  occurrenceStartAt: string;
  runId: string;
  createdById: string | null;
  createdByKind: RunDomainEventActorKind;
  createdAt: string;
};

type TxOrm = typeof orm;

function mapRow(row: Record<string, unknown>): CommunityScheduleRunRecord {
  return {
    id: asString(row.id),
    scheduleSlotId: row.scheduleSlotId == null ? null : asString(row.scheduleSlotId),
    // ISO normalize — Postgres/Prisma readbacks are not always `Date.toISOString()`.
    windowStartAt: asIsoTimestamp(row.windowStartAt),
    occurrenceStartAt: asIsoTimestamp(row.occurrenceStartAt),
    runId: asString(row.runId),
    createdById: row.createdById == null ? null : asString(row.createdById),
    createdByKind: mapRunDomainEventActorKind(row.createdByKind),
    createdAt: asIsoTimestamp(row.createdAt),
  };
}

function hasPgErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const record = current as { code?: unknown; sqlState?: unknown; cause?: unknown };
    if (record.code === code || record.sqlState === code) return true;
    current = record.cause;
  }
  return false;
}

/** Postgres unique violation (23505), including wrapped driver errors. */
export function isUniqueViolation(error: unknown): boolean {
  return hasPgErrorCode(error, "23505");
}

/** Postgres foreign-key violation (23503), including wrapped driver errors. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPgErrorCode(error, "23503");
}

export const communityScheduleRunRepository = {
  async findBySlotAndWindow(
    scheduleSlotId: string,
    windowStartAt: string,
  ): Promise<CommunityScheduleRunRecord | null> {
    const row = await orm.CommunityScheduleRun.where({ scheduleSlotId, windowStartAt }).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  async findByRunId(runId: string): Promise<CommunityScheduleRunRecord | null> {
    const row = await orm.CommunityScheduleRun.where({ runId }).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  async listBySlotIds(slotIds: readonly string[]): Promise<CommunityScheduleRunRecord[]> {
    const unique = [...new Set(slotIds)];
    if (unique.length === 0) return [];
    const rows = await orm.CommunityScheduleRun.where((link) => link.scheduleSlotId.in(unique)).all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  },

  /**
   * Batch: which of the given slots currently have at least one linked
   * CommunityScheduleRun (scheduleSlotId not yet SET NULL).
   */
  async slotIdsWithMaterialization(
    slotIds: readonly string[],
    txOrm?: TxOrm,
  ): Promise<Set<string>> {
    const unique = [...new Set(slotIds)];
    if (unique.length === 0) return new Set();
    const client = txOrm ?? orm;
    const rows = await client.CommunityScheduleRun.where((link) =>
      link.scheduleSlotId.in(unique),
    ).all();
    const out = new Set<string>();
    for (const row of rows) {
      const slotId = (row as Record<string, unknown>).scheduleSlotId;
      if (slotId != null) out.add(asString(slotId));
    }
    return out;
  },

  async create(
    input: {
      scheduleSlotId: string;
      windowStartAt: string;
      occurrenceStartAt: string;
      runId: string;
      createdById: string | null;
      createdByKind: RunDomainEventActorKind;
    },
    txOrm?: TxOrm,
  ): Promise<CommunityScheduleRunRecord> {
    const client = txOrm ?? orm;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.CommunityScheduleRun.create({
      id,
      scheduleSlotId: input.scheduleSlotId,
      windowStartAt: input.windowStartAt,
      occurrenceStartAt: input.occurrenceStartAt,
      runId: input.runId,
      createdById: input.createdById,
      createdByKind: input.createdByKind,
      createdAt: now,
    });
    const created = await client.CommunityScheduleRun.where({ id }).first();
    if (!created) {
      throw new Error("CommunityScheduleRun create failed.");
    }
    return mapRow(created as Record<string, unknown>);
  },
};
