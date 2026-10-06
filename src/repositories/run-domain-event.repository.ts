import { orm } from "@/lib/prisma";
import {
  asString,
  asStringOrNull,
  mapRunDomainEventActorKind,
} from "@/lib/persistence";
import {
  normalizeRunDomainEventActor,
  serializeRunDomainEventPayload,
  type RunDomainEventWriteInput,
} from "@/lib/run-domain-event";
import type { RunDomainEventActorKind } from "@/models/enums";

export type RunDomainEventRecord = {
  id: string;
  runId: string;
  actorUserId: string | null;
  actorKind: RunDomainEventActorKind;
  type: string;
  summary: string;
  payloadJson: string | null;
  occurredAt: string;
};

const MAX_LIST_LIMIT = 100;

function mapRow(row: Record<string, unknown>): RunDomainEventRecord {
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    actorUserId: asStringOrNull(row.actorUserId),
    actorKind: mapRunDomainEventActorKind(row.actorKind),
    type: asString(row.type),
    summary: asString(row.summary),
    payloadJson: asStringOrNull(row.payloadJson),
    occurredAt: asString(row.occurredAt),
  };
}

export const runDomainEventRepository = {
  async create(input: RunDomainEventWriteInput): Promise<RunDomainEventRecord> {
    const actor = normalizeRunDomainEventActor({
      actorKind: input.actorKind,
      actorUserId: input.actorUserId,
    });
    const now = input.occurredAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    const summary = input.summary.trim().slice(0, 500);
    if (!summary) {
      throw new Error("RunDomainEvent summary is required.");
    }
    await orm.RunDomainEvent.create({
      id,
      runId: input.runId,
      actorUserId: actor.actorUserId,
      actorKind: actor.actorKind,
      type: input.type.trim().slice(0, 80),
      summary,
      payloadJson: serializeRunDomainEventPayload(input.payload),
      occurredAt: now,
    });
    const row = (await orm.RunDomainEvent.where({ id }).first()) as Record<string, unknown> | null;
    if (!row) {
      throw new Error("RunDomainEvent create did not persist.");
    }
    return mapRow(row);
  },

  /**
   * Newest-first bounded chronology for one Run. Never unbounded.
   */
  async listForRun(runId: string, limit: number, offset = 0): Promise<RunDomainEventRecord[]> {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_LIST_LIMIT);
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = (await orm.RunDomainEvent.where({ runId })
      .orderBy((event) => event.occurredAt.desc())
      .limit(safeLimit)
      .offset(safeOffset)
      .all()) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  },
};
