import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";

export type RunStartSnapshotRecord = {
  id: string;
  runId: string;
  startedAt: string;
  startedById: string;
  startedByName: string | null;
};

function mapRow(row: Record<string, unknown>): RunStartSnapshotRecord {
  const starter = row.startedBy as Record<string, unknown> | undefined;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    startedAt: asString(row.startedAt),
    startedById: asString(row.startedById),
    startedByName: starter ? asString(starter.name) : null,
  };
}

export const runStartSnapshotRepository = {
  /** runId → startedAt for the given Runs (one query). */
  async startedAtByRunIds(runIds: readonly string[]): Promise<Map<string, string>> {
    if (runIds.length === 0) return new Map();
    const rows = (await orm.RunStartSnapshot.where((row) => row.runId.in([...runIds]))
      .select("runId", "startedAt")
      .all()) as Array<{ runId: string; startedAt: string }>;
    return new Map(rows.map((row) => [row.runId, row.startedAt]));
  },

  async findByRunId(runId: string): Promise<RunStartSnapshotRecord | null> {
    const row = await orm.RunStartSnapshot.where({ runId }).include("startedBy").first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },
};
