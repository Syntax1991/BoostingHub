import { orm } from "@/lib/prisma";
import {
  asString,
  asStringOrNull,
  mapDifficulty,
  mapQualificationStatus,
} from "@/lib/persistence";
import type { BoosterQualificationRecord } from "@/models/records";
import type { BoosterQualificationStatus, RaidDifficulty } from "@/models/enums";

export type BoosterQualificationWriteInput = {
  id: string;
  userId: string;
  difficulty: RaidDifficulty;
  status: BoosterQualificationStatus;
  notes: string | null;
  grantedAt: string | null;
  grantedById: string | null;
  revokedAt: string | null;
  revokedById: string | null;
};

export type BoosterQualificationPatch = {
  status?: BoosterQualificationStatus;
  notes?: string | null;
  grantedAt?: string | null;
  grantedById?: string | null;
  revokedAt?: string | null;
  revokedById?: string | null;
};

export type BoosterQualificationAdminFilters = {
  status?: BoosterQualificationStatus;
  difficulty?: RaidDifficulty;
  userId?: string;
};

export type BoosterQualificationAdminRecord = BoosterQualificationRecord & {
  userName: string;
  grantedByName: string | null;
};

function mapQualification(row: Record<string, unknown>): BoosterQualificationRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    difficulty: mapDifficulty(row.difficulty),
    status: mapQualificationStatus(row.status),
    notes: asStringOrNull(row.notes),
    grantedAt: asStringOrNull(row.grantedAt),
    grantedById: asStringOrNull(row.grantedById),
    revokedAt: asStringOrNull(row.revokedAt),
    revokedById: asStringOrNull(row.revokedById),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

function mapAdminRow(row: Record<string, unknown>): BoosterQualificationAdminRecord {
  const user = (row.user ?? {}) as Record<string, unknown>;
  const grantedBy = row.grantedBy ? (row.grantedBy as Record<string, unknown>) : null;
  return {
    ...mapQualification(row),
    userName: asString(user.name, "Unknown"),
    grantedByName: grantedBy ? asString(grantedBy.name) : null,
  };
}

export const boosterQualificationRepository = {
  async listByUserId(userId: string): Promise<BoosterQualificationRecord[]> {
    const rows = await orm.BoosterQualification.where({ userId }).all();
    return rows.map((row) => mapQualification(row as Record<string, unknown>));
  },

  async findById(id: string): Promise<BoosterQualificationRecord | null> {
    const row = await orm.BoosterQualification.where({ id }).first();
    return row ? mapQualification(row as Record<string, unknown>) : null;
  },

  async findExact(
    userId: string,
    difficulty: RaidDifficulty,
  ): Promise<BoosterQualificationRecord | null> {
    const row = await orm.BoosterQualification.where({ userId, difficulty }).first();
    return row ? mapQualification(row as Record<string, unknown>) : null;
  },

  async create(input: BoosterQualificationWriteInput): Promise<BoosterQualificationRecord> {
    const now = new Date().toISOString();
    await orm.BoosterQualification.create({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("BoosterQualification create did not persist.");
    }
    return created;
  },

  async update(id: string, patch: BoosterQualificationPatch): Promise<void> {
    await orm.BoosterQualification.where({ id }).update({
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },

  async countByStatus(): Promise<Record<BoosterQualificationStatus, number>> {
    const rows = await orm.BoosterQualification.select("status").all();
    const counts: Record<BoosterQualificationStatus, number> = {
      APPROVED: 0,
      REVOKED: 0,
    };
    for (const row of rows) {
      const status = mapQualificationStatus((row as Record<string, unknown>).status);
      counts[status] += 1;
    }
    return counts;
  },

  async countApproved(): Promise<number> {
    const counts = await this.countByStatus();
    return counts.APPROVED;
  },

  async listAdmin(
    filters: BoosterQualificationAdminFilters = {},
  ): Promise<BoosterQualificationAdminRecord[]> {
    let query = orm.BoosterQualification
      .include("user")
      .include("grantedBy")
      .orderBy((row) => row.updatedAt.desc());

    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    if (filters.difficulty) {
      query = query.where({ difficulty: filters.difficulty });
    }
    if (filters.userId) {
      query = query.where({ userId: filters.userId });
    }

    const rows = await query.all();
    return rows.map((row) => mapAdminRow(row as Record<string, unknown>));
  },

  /** One roundtrip for every roster/signup hydration path — never one query per user. */
  async listByUserIds(userIds: string[]): Promise<BoosterQualificationRecord[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    const rows = await orm.BoosterQualification.where((q) => q.userId.in(unique)).all();
    return rows.map((row) => mapQualification(row as Record<string, unknown>));
  },
};
