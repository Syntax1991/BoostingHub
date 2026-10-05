import { orm } from "@/lib/prisma";
import {
  asNumberOrNull,
  asString,
  asStringOrNull,
  mapIntegrationEventStatus,
  mapIntegrationProvider,
  mapWowRegionOrNull,
} from "@/lib/persistence";
import {
  serializeIntegrationMetadata,
  type IntegrationEventWriteInput,
} from "@/lib/integration-telemetry";
import type { IntegrationEventStatus, IntegrationProvider, WowRegion } from "@/models/enums";

export type IntegrationEventRecord = {
  id: string;
  provider: IntegrationProvider;
  operation: string;
  status: IntegrationEventStatus;
  createdAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  entityType: string | null;
  entityId: string | null;
  region: WowRegion | null;
  metadataJson: string | null;
};

export type IntegrationEventListFilters = {
  provider?: IntegrationProvider;
  status?: IntegrationEventStatus;
  operation?: string;
  /** Inclusive lower bound ISO timestamp. */
  createdAfter?: string;
  /** Exclusive upper bound ISO timestamp. */
  createdBefore?: string;
  /** Hard cap — callers must pass a finite positive limit. */
  limit: number;
  /** Skip for pagination; default 0. */
  offset?: number;
};

const MAX_LIST_LIMIT = 100;

function mapRow(row: Record<string, unknown>): IntegrationEventRecord {
  return {
    id: asString(row.id),
    provider: mapIntegrationProvider(row.provider),
    operation: asString(row.operation),
    status: mapIntegrationEventStatus(row.status),
    createdAt: asString(row.createdAt),
    durationMs: asNumberOrNull(row.durationMs),
    httpStatus: asNumberOrNull(row.httpStatus),
    errorCode: asStringOrNull(row.errorCode),
    entityType: asStringOrNull(row.entityType),
    entityId: asStringOrNull(row.entityId),
    region: mapWowRegionOrNull(row.region),
    metadataJson: asStringOrNull(row.metadataJson),
  };
}

export const integrationEventRepository = {
  async create(input: IntegrationEventWriteInput): Promise<IntegrationEventRecord> {
    const now = input.createdAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    await orm.IntegrationEvent.create({
      id,
      provider: input.provider,
      operation: input.operation.trim().slice(0, 120),
      status: input.status,
      createdAt: now,
      durationMs: input.durationMs ?? null,
      httpStatus: input.httpStatus ?? null,
      errorCode: input.errorCode ? input.errorCode.trim().slice(0, 120) : null,
      entityType: input.entityType ? input.entityType.trim().slice(0, 80) : null,
      entityId: input.entityId ? input.entityId.trim().slice(0, 80) : null,
      region: input.region ?? null,
      metadataJson: serializeIntegrationMetadata(input.metadata),
    });
    const row = (await orm.IntegrationEvent.where({ id }).first()) as Record<string, unknown> | null;
    if (!row) {
      throw new Error("IntegrationEvent create did not persist.");
    }
    return mapRow(row);
  },

  /**
   * Newest-first bounded list. Never unbounded — limit is required and capped.
   */
  async listRecent(filters: IntegrationEventListFilters): Promise<IntegrationEventRecord[]> {
    const limit = Math.min(Math.max(1, Math.floor(filters.limit)), MAX_LIST_LIMIT);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    let query = orm.IntegrationEvent.orderBy((event) => event.createdAt.desc());
    if (filters.provider) {
      query = query.where({ provider: filters.provider });
    }
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    if (filters.operation?.trim()) {
      query = query.where({ operation: filters.operation.trim() });
    }
    if (filters.createdAfter) {
      const after = filters.createdAfter;
      query = query.where((event) => event.createdAt.gte(after));
    }
    if (filters.createdBefore) {
      const before = filters.createdBefore;
      query = query.where((event) => event.createdAt.lt(before));
    }

    const rows = (await query.limit(limit).offset(offset).all()) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  },

  /** Delete events strictly older than `olderThanIso`. Returns deleted count. */
  async deleteOlderThan(olderThanIso: string): Promise<number> {
    // Bounded maintenance: load ids then delete (no bulk-delete API used elsewhere).
    const rows = (await orm.IntegrationEvent.where((event) => event.createdAt.lt(olderThanIso))
      .select("id")
      .limit(5000)
      .all()) as Array<Record<string, unknown>>;
    let deleted = 0;
    for (const row of rows) {
      await orm.IntegrationEvent.where({ id: asString(row.id) }).delete();
      deleted += 1;
    }
    return deleted;
  },
};
