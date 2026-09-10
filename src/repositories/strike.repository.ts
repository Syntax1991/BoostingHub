import { orm } from "@/lib/prisma";
import { asString, asStringOrNull, mapStrikeStatus } from "@/lib/persistence";
import type { StrikeStatus } from "@/models/enums";

export type StrikeRecord = {
  id: string;
  userId: string;
  userName: string;
  runId: string | null;
  runTitle: string | null;
  attendanceId: string | null;
  reason: string;
  notes: string | null;
  status: StrikeStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedById: string | null;
  revokedByName: string | null;
  revokedReason: string | null;
};

export type StrikeCreateInput = {
  id: string;
  userId: string;
  runId: string | null;
  attendanceId: string | null;
  reason: string;
  notes: string | null;
  createdById: string;
};

function mapStrike(row: Record<string, unknown>): StrikeRecord {
  const user = (row.user ?? {}) as Record<string, unknown>;
  const run = row.run ? (row.run as Record<string, unknown>) : null;
  const createdBy = (row.createdBy ?? {}) as Record<string, unknown>;
  const revokedBy = row.revokedBy ? (row.revokedBy as Record<string, unknown>) : null;
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    userName: asString(user.name, "Unknown"),
    runId: asStringOrNull(row.runId),
    runTitle: run ? asString(run.title) : null,
    attendanceId: asStringOrNull(row.attendanceId),
    reason: asString(row.reason),
    notes: asStringOrNull(row.notes),
    status: mapStrikeStatus(row.status),
    createdById: asString(row.createdById),
    createdByName: asString(createdBy.name, "Unknown"),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
    revokedAt: asStringOrNull(row.revokedAt),
    revokedById: asStringOrNull(row.revokedById),
    revokedByName: revokedBy ? asString(revokedBy.name) : null,
    revokedReason: asStringOrNull(row.revokedReason),
  };
}

function strikeQuery() {
  return orm.Strike
    .include("user")
    .include("run")
    .include("createdBy")
    .include("revokedBy");
}

export const strikeRepository = {
  async findById(id: string): Promise<StrikeRecord | null> {
    const row = await strikeQuery().where({ id }).first();
    return row ? mapStrike(row as Record<string, unknown>) : null;
  },

  async listByUserId(userId: string): Promise<StrikeRecord[]> {
    const rows = await strikeQuery()
      .where({ userId })
      .orderBy((strike) => strike.createdAt.desc())
      .all();
    return rows.map((row) => mapStrike(row as Record<string, unknown>));
  },

  async listByRunId(runId: string): Promise<StrikeRecord[]> {
    const rows = await strikeQuery()
      .where({ runId })
      .orderBy((strike) => strike.createdAt.desc())
      .all();
    return rows.map((row) => mapStrike(row as Record<string, unknown>));
  },

  async create(input: StrikeCreateInput): Promise<StrikeRecord> {
    const now = new Date().toISOString();
    await orm.Strike.create({
      id: input.id,
      userId: input.userId,
      runId: input.runId,
      attendanceId: input.attendanceId,
      reason: input.reason,
      notes: input.notes,
      status: "ACTIVE",
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Strike create did not persist.");
    }
    return created;
  },

  async revoke(
    id: string,
    fields: { revokedAt: string; revokedById: string; revokedReason: string },
  ): Promise<void> {
    await orm.Strike.where({ id }).update({
      status: "REVOKED",
      revokedAt: fields.revokedAt,
      revokedById: fields.revokedById,
      revokedReason: fields.revokedReason,
      updatedAt: new Date().toISOString(),
    });
  },
};
