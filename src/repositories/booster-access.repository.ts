import { orm } from "@/lib/prisma";
import { mapAccessStatus, mapCharacterRole, mapDifficulty, mapWowClass } from "@/lib/persistence";
import type { BoosterAccessRecord } from "@/models/records";

export const boosterAccessRepository = {
  async listByUserId(userId: string): Promise<BoosterAccessRecord[]> {
    const rows = await orm.BoosterAccess.where({ userId }).all();
    return rows.map((row) => ({
      wowClass: mapWowClass(row.wowClass),
      role: mapCharacterRole(row.role),
      difficulty: mapDifficulty(row.difficulty),
      status: mapAccessStatus(row.status),
    }));
  },
};
