import { orm } from "@/lib/prisma";
import {
  asString,
  asStringOrNull,
  mapAccessStatus,
  mapCharacterRole,
  mapDifficulty,
  mapRegion,
  mapWowClass,
} from "@/lib/persistence";
import type { BoosterAccessRecord } from "@/models/records";
import type { BoosterAccessStatus, CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";

export type BoosterAccessWriteInput = {
  id: string;
  userId: string;
  characterId: string | null;
  wowClass: WowClass;
  role: CharacterRole;
  difficulty: RaidDifficulty;
  status: BoosterAccessStatus;
  notes: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
};

export type BoosterAccessStatusPatch = {
  status: BoosterAccessStatus;
  characterId?: string | null;
  notes: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
};

export type BoosterAccessAdminFilters = {
  status?: BoosterAccessStatus;
  difficulty?: RaidDifficulty;
  role?: CharacterRole;
};

export type BoosterAccessAdminRecord = BoosterAccessRecord & {
  userName: string;
  characterName: string | null;
  realm: string | null;
  region: ReturnType<typeof mapRegion> | null;
  specialization: string | null;
  primaryRole: CharacterRole | null;
  itemLevel: number | null;
  characterActive: boolean | null;
  reviewedByName: string | null;
};

function mapAccess(row: Record<string, unknown>): BoosterAccessRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    characterId: asStringOrNull(row.characterId),
    wowClass: mapWowClass(row.wowClass),
    role: mapCharacterRole(row.role),
    difficulty: mapDifficulty(row.difficulty),
    status: mapAccessStatus(row.status),
    notes: asStringOrNull(row.notes),
    approvedAt: asStringOrNull(row.approvedAt),
    approvedById: asStringOrNull(row.approvedById),
    reviewedAt: asStringOrNull(row.reviewedAt),
    reviewedById: asStringOrNull(row.reviewedById),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

function mapAdminRow(row: Record<string, unknown>): BoosterAccessAdminRecord {
  const user = (row.user ?? {}) as Record<string, unknown>;
  const character = row.character ? (row.character as Record<string, unknown>) : null;
  const reviewedBy = row.reviewedBy ? (row.reviewedBy as Record<string, unknown>) : null;
  return {
    ...mapAccess(row),
    userName: asString(user.name, "Unknown"),
    characterName: character ? asString(character.name) : null,
    realm: character ? asString(character.realm) : null,
    region: character ? mapRegion(character.region) : null,
    specialization: character ? asStringOrNull(character.specialization) : null,
    primaryRole: character ? mapCharacterRole(character.primaryRole) : null,
    itemLevel: character && typeof character.itemLevel === "number" ? character.itemLevel : null,
    characterActive: character && typeof character.isActive === "boolean" ? character.isActive : null,
    reviewedByName: reviewedBy ? asString(reviewedBy.name) : null,
  };
}

export const boosterAccessRepository = {
  async listByUserId(userId: string): Promise<BoosterAccessRecord[]> {
    const rows = await orm.BoosterAccess.where({ userId }).all();
    return rows.map((row) => mapAccess(row as Record<string, unknown>));
  },

  async findById(id: string): Promise<BoosterAccessRecord | null> {
    const row = await orm.BoosterAccess.where({ id }).first();
    return row ? mapAccess(row as Record<string, unknown>) : null;
  },

  async findExact(
    userId: string,
    wowClass: WowClass,
    role: CharacterRole,
    difficulty: RaidDifficulty,
  ): Promise<BoosterAccessRecord | null> {
    const row = await orm.BoosterAccess.where({ userId, wowClass, role, difficulty }).first();
    return row ? mapAccess(row as Record<string, unknown>) : null;
  },

  async create(input: BoosterAccessWriteInput): Promise<BoosterAccessRecord> {
    const now = new Date().toISOString();
    await orm.BoosterAccess.create({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("BoosterAccess create did not persist.");
    }
    return created;
  },

  async updateStatus(id: string, patch: BoosterAccessStatusPatch): Promise<void> {
    await orm.BoosterAccess.where({ id }).update({
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },

  async countByStatus(): Promise<Record<BoosterAccessStatus, number>> {
    const rows = await orm.BoosterAccess.select("status").all();
    const counts: Record<BoosterAccessStatus, number> = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      REVOKED: 0,
    };
    for (const row of rows) {
      const status = mapAccessStatus((row as Record<string, unknown>).status);
      counts[status] += 1;
    }
    return counts;
  },

  async listAdmin(filters: BoosterAccessAdminFilters = {}): Promise<BoosterAccessAdminRecord[]> {
    let query = orm.BoosterAccess
      .include("user")
      .include("character")
      .include("reviewedBy")
      .orderBy((row) => row.createdAt.desc());

    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    if (filters.difficulty) {
      query = query.where({ difficulty: filters.difficulty });
    }
    if (filters.role) {
      query = query.where({ role: filters.role });
    }

    const rows = await query.all();
    return rows.map((row) => mapAdminRow(row as Record<string, unknown>));
  },
};
