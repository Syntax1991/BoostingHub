import type { BoosterAccessRecord } from "@/models/records";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";

export type { BoosterAccessRecord };

/**
 * Booster access is scoped separately from account roles because a user can
 * participate as a lootbuddy in one run while being an approved booster in another.
 */
export const boosterAccessService = {
  isApprovedFor(
    records: BoosterAccessRecord[],
    wowClass: WowClass,
    role: CharacterRole,
    difficulty: RaidDifficulty,
  ): boolean {
    return records.some(
      (record) =>
        record.status === "APPROVED" &&
        record.wowClass === wowClass &&
        record.role === role &&
        record.difficulty === difficulty,
    );
  },

  summarize(records: BoosterAccessRecord[]) {
    const approved = records.filter((record) => record.status === "APPROVED");
    return {
      approvedCount: approved.length,
      pendingCount: records.filter((record) => record.status === "PENDING").length,
      revokedCount: records.filter((record) => record.status === "REVOKED").length,
      approvals: approved.map((record) => ({
        wowClass: record.wowClass,
        role: record.role,
        difficulty: record.difficulty,
      })),
    };
  },
};
