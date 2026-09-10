import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanReviewBoosterAccess } from "@/auth/authorization";
import type { BoosterQualificationMatch, BoosterQualificationRecord } from "@/models/records";
import type { BoosterQualificationStatus, RaidDifficulty } from "@/models/enums";
import { RAID_DIFFICULTIES } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { getDiscordBoosterTicketUrl } from "@/lib/discord-config";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { activityRepository } from "@/repositories/activity.repository";
import {
  boosterQualificationRepository,
  type BoosterQualificationAdminRecord,
} from "@/repositories/booster-qualification.repository";
import { userRepository } from "@/repositories/user.repository";
import {
  assertBoosterQualificationTransition,
  isApprovedQualificationStatus,
} from "@/services/booster-qualification-state";

export type { BoosterQualificationMatch, BoosterQualificationRecord };

export type AccountAccessDifficultyCell = {
  difficulty: RaidDifficulty;
  status: BoosterQualificationStatus | "NONE";
  qualificationId: string | null;
  notes: string | null;
};

export type AccountAccessPanel = {
  difficulties: AccountAccessDifficultyCell[];
  discordTicketUrl: string | null;
  selfRequestDisabled: true;
};

export type AdminQualificationFilters = {
  status?: BoosterQualificationStatus | "ALL";
  difficulty?: RaidDifficulty;
  query?: string;
  userId?: string;
};

export type AdminQualificationRow = BoosterQualificationAdminRecord;

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

/**
 * Authoritative Booster eligibility is User + Difficulty only.
 * Exact match: Heroic never implies Normal or Mythic. ADMIN has no bypass.
 */
export const boosterQualificationService = {
  isApprovedFor(records: BoosterQualificationMatch[], difficulty: RaidDifficulty): boolean {
    return records.some(
      (record) => isApprovedQualificationStatus(record.status) && record.difficulty === difficulty,
    );
  },

  summarize(records: BoosterQualificationMatch[]) {
    const approved = records.filter((record) => record.status === "APPROVED");
    return {
      approvedCount: approved.length,
      revokedCount: records.filter((record) => record.status === "REVOKED").length,
      approvals: approved.map((record) => ({
        difficulty: record.difficulty,
      })),
    };
  },

  buildAccountAccessPanel(qualifications: BoosterQualificationRecord[]): AccountAccessPanel {
    return {
      difficulties: RAID_DIFFICULTIES.map((difficulty) => {
        const existing = qualifications.find((record) => record.difficulty === difficulty);
        return {
          difficulty,
          status: existing?.status ?? "NONE",
          qualificationId: existing?.id ?? null,
          notes: existing?.notes ?? null,
        };
      }),
      discordTicketUrl: getDiscordBoosterTicketUrl(),
      selfRequestDisabled: true,
    };
  },

  async grant(
    admin: AuthenticatedUser,
    input: { userId: string; difficulty: RaidDifficulty; notes?: string },
  ): Promise<BoosterQualificationRecord> {
    assertCanReviewBoosterAccess(admin);

    const target = await userRepository.findById(input.userId);
    if (!target) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }

    const existing = await boosterQualificationRepository.findExact(input.userId, input.difficulty);
    if (existing?.status === "APPROVED") {
      throw new DomainError(
        "BOOSTER_ACCESS_ALREADY_APPROVED",
        "That difficulty is already approved.",
      );
    }

    const now = new Date().toISOString();
    const notes = input.notes?.trim() || "Reviewed through Discord";
    const label = DIFFICULTY_LABELS[input.difficulty];

    if (!existing) {
      try {
        const created = await boosterQualificationRepository.create({
          id: crypto.randomUUID(),
          userId: input.userId,
          difficulty: input.difficulty,
          status: "APPROVED",
          notes,
          grantedAt: now,
          grantedById: admin.id,
          revokedAt: null,
          revokedById: null,
        });
        await activityRepository.create({
          userId: admin.id,
          type: "BOOSTER_ACCESS_GRANTED",
          message: `Granted ${label} Booster access to ${target.name}.`,
        });
        return created;
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new DomainError(
            "BOOSTER_ACCESS_ALREADY_APPROVED",
            "That difficulty is already approved.",
          );
        }
        throw error;
      }
    }

    assertBoosterQualificationTransition(existing.status, "APPROVED");
    await boosterQualificationRepository.update(existing.id, {
      status: "APPROVED",
      notes,
      grantedAt: now,
      grantedById: admin.id,
      revokedAt: null,
      revokedById: null,
    });
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_GRANTED",
      message: `Granted ${label} Booster access to ${target.name}.`,
    });
    const updated = await boosterQualificationRepository.findById(existing.id);
    if (!updated) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster qualification was not found.", 404);
    }
    return updated;
  },

  async revoke(
    admin: AuthenticatedUser,
    qualificationId: string,
    reason?: string,
  ): Promise<BoosterQualificationRecord> {
    assertCanReviewBoosterAccess(admin);
    const qualification = await boosterQualificationRepository.findById(qualificationId);
    if (!qualification) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster qualification was not found.", 404);
    }
    assertBoosterQualificationTransition(qualification.status, "REVOKED");

    const target = await userRepository.findById(qualification.userId);
    const targetName = target?.name ?? "user";
    const now = new Date().toISOString();
    await boosterQualificationRepository.update(qualification.id, {
      status: "REVOKED",
      notes: reason ?? qualification.notes,
      revokedAt: now,
      revokedById: admin.id,
    });
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_REVOKED",
      message: `Revoked ${DIFFICULTY_LABELS[qualification.difficulty]} Booster access from ${targetName}.`,
    });
    const updated = await boosterQualificationRepository.findById(qualification.id);
    if (!updated) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster qualification was not found.", 404);
    }
    return updated;
  },

  /**
   * Legacy approve bridge: ensure an APPROVED qualification exists for the difficulty.
   * No-op when already APPROVED.
   */
  async ensureApproved(
    admin: AuthenticatedUser,
    input: { userId: string; difficulty: RaidDifficulty; notes?: string },
  ): Promise<BoosterQualificationRecord> {
    assertCanReviewBoosterAccess(admin);
    const existing = await boosterQualificationRepository.findExact(input.userId, input.difficulty);
    if (existing?.status === "APPROVED") {
      return existing;
    }
    return this.grant(admin, input);
  },

  async listAdminQualifications(
    admin: AuthenticatedUser,
    filters: AdminQualificationFilters = {},
  ): Promise<AdminQualificationRow[]> {
    assertCanReviewBoosterAccess(admin);

    let status: BoosterQualificationStatus | undefined;
    if (filters.status && filters.status !== "ALL") {
      status = filters.status;
    }

    let rows = await boosterQualificationRepository.listAdmin({
      status,
      difficulty: filters.difficulty,
      userId: filters.userId,
    });

    const query = filters.query?.trim().toLocaleLowerCase("en-US");
    if (query) {
      rows = rows.filter((row) => matchesAdminQuery(row, query));
    }

    return rows;
  },
};

function matchesAdminQuery(row: AdminQualificationRow, query: string) {
  const haystack = [row.userName, DIFFICULTY_LABELS[row.difficulty], row.grantedByName, row.notes]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
  return haystack.includes(query);
}
