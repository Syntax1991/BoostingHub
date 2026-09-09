import { orm } from "@/lib/prisma";
import { asString, asStringOrNull, mapRegion } from "@/lib/persistence";
import type { WowRegion } from "@/models/enums";

export type BattleNetConnectionRecord = {
  id: string;
  userId: string;
  region: ReturnType<typeof mapRegion>;
  battleNetAccountId: string;
  battleTag: string | null;
  scope: string | null;
  connectedAt: string;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapConnection(row: Record<string, unknown>): BattleNetConnectionRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    region: mapRegion(row.region),
    battleNetAccountId: asString(row.battleNetAccountId),
    battleTag: asStringOrNull(row.battleTag),
    scope: asStringOrNull(row.scope),
    connectedAt: asString(row.connectedAt),
    lastSuccessfulSyncAt: asStringOrNull(row.lastSuccessfulSyncAt),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export const battleNetConnectionRepository = {
  async listByUserId(userId: string): Promise<BattleNetConnectionRecord[]> {
    const rows = await orm.BattleNetConnection
      .where({ userId })
      .orderBy((connection) => connection.region.asc())
      .all();
    return rows.map((row) => mapConnection(row as Record<string, unknown>));
  },

  async findByUserAndRegion(
    userId: string,
    region: WowRegion,
  ): Promise<BattleNetConnectionRecord | null> {
    const row = await orm.BattleNetConnection.where({ userId, region }).first();
    return row ? mapConnection(row as Record<string, unknown>) : null;
  },

  async upsert(input: {
    userId: string;
    region: WowRegion;
    battleNetAccountId: string;
    battleTag: string | null;
    scope: string | null;
  }): Promise<BattleNetConnectionRecord> {
    const existing = await this.findByUserAndRegion(input.userId, input.region);
    const now = new Date().toISOString();

    if (existing) {
      await orm.BattleNetConnection.where({ id: existing.id }).update({
        battleNetAccountId: input.battleNetAccountId,
        battleTag: input.battleTag,
        scope: input.scope,
        connectedAt: now,
        updatedAt: now,
      });
      const updated = await this.findByUserAndRegion(input.userId, input.region);
      if (!updated) {
        throw new Error("BattleNetConnection update did not persist.");
      }
      return updated;
    }

    const id = crypto.randomUUID();
    await orm.BattleNetConnection.create({
      id,
      userId: input.userId,
      region: input.region,
      battleNetAccountId: input.battleNetAccountId,
      battleTag: input.battleTag,
      scope: input.scope,
      connectedAt: now,
      lastSuccessfulSyncAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.findByUserAndRegion(input.userId, input.region);
    if (!created) {
      throw new Error("BattleNetConnection create did not persist.");
    }
    return created;
  },

  async markSuccessfulSync(connectionId: string, syncedAt: string): Promise<void> {
    await orm.BattleNetConnection.where({ id: connectionId }).update({
      lastSuccessfulSyncAt: syncedAt,
      updatedAt: new Date().toISOString(),
    });
  },

  async deleteByUserAndRegion(userId: string, region: WowRegion): Promise<void> {
    const existing = await this.findByUserAndRegion(userId, region);
    if (!existing) return;
    await orm.BattleNetConnection.where({ id: existing.id }).delete();
  },
};
