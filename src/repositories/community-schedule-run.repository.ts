import { orm } from "@/lib/prisma";
import { asIsoTimestamp, asString, mapRunDomainEventActorKind } from "@/lib/persistence";
import type { RunDomainEventActorKind } from "@/models/enums";

export type CommunityScheduleRunRecord = {
  id: string;
  scheduleSlotId: string;
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
    scheduleSlotId: asString(row.scheduleSlotId),
    // ISO normalize — Postgres/Prisma readbacks are not always `Date.toISOString()`.
    windowStartAt: asIsoTimestamp(row.windowStartAt),
    occurrenceStartAt: asIsoTimestamp(row.occurrenceStartAt),
    runId: asString(row.runId),
    createdById: row.createdById == null ? null : asString(row.createdById),
    createdByKind: mapRunDomainEventActorKind(row.createdByKind),
    createdAt: asIsoTimestamp(row.createdAt),
  };
}

/** Postgres unique violation (23505), including wrapped driver errors. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const record = current as { code?: unknown; sqlState?: unknown; cause?: unknown };
    if (record.code === "23505" || record.sqlState === "23505") return true;
    current = record.cause;
  }
  return false;
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
