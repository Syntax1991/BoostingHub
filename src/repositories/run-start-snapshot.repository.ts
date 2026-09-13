import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";

export type RunStartSnapshotRecord = {
  id: string;
  runId: string;
  goldCollector1Name: string;
  goldCollector1Realm: string;
  goldCollector2Name: string;
  goldCollector2Realm: string;
  startedAt: string;
  startedById: string;
  startedByName: string | null;
};

function mapRow(row: Record<string, unknown>): RunStartSnapshotRecord {
  const starter = row.startedBy as Record<string, unknown> | undefined;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    goldCollector1Name: asString(row.goldCollector1Name),
    goldCollector1Realm: asString(row.goldCollector1Realm),
    goldCollector2Name: asString(row.goldCollector2Name),
    goldCollector2Realm: asString(row.goldCollector2Realm),
    startedAt: asString(row.startedAt),
    startedById: asString(row.startedById),
    startedByName: starter ? asString(starter.name) : null,
  };
}

export const runStartSnapshotRepository = {
  async findByRunId(runId: string): Promise<RunStartSnapshotRecord | null> {
    const row = await orm.RunStartSnapshot.where({ runId }).include("startedBy").first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },
};
