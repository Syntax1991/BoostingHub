import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanReviewBoosterAccess } from "@/auth/authorization";
import type { BoosterQualificationMatch, BoosterQualificationRecord } from "@/models/records";
import type { BoosterQualificationStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { getDiscordBoosterTicketUrl } from "@/lib/discord-config";
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

/** Account-level booster approval state. NONE = never granted. */
export type BoosterApprovalState = BoosterQualificationStatus | "NONE";

export type BoosterApprovalSummary = {
  status: BoosterApprovalState;
  approved: boolean;
};

export type AccountAccessPanel = BoosterApprovalSummary & {
  qualificationId: string | null;
  notes: string | null;
  discordTicketUrl: string | null;
  selfRequestDisabled: true;
};

export type AdminQualificationFilters = {
  status?: BoosterQualificationStatus | "ALL";
  query?: string;
  userId?: string;
};

export type AdminQualificationRow = BoosterQualificationAdminRecord;

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

/**
 * Authoritative Booster eligibility is one account-level qualification per User.
 * It is deliberately NOT scoped by raid difficulty: an APPROVED booster may boost
 * Normal, Heroic and Mythic Runs alike. ADMIN has no bypass.
 */
export const boosterQualificationService = {
  isApprovedBooster(qualification: BoosterQualificationMatch | null | undefined): boolean {
    return qualification ? isApprovedQualificationStatus(qualification.status) : false;
  },

  summarize(qualification: BoosterQualificationMatch | null | undefined): BoosterApprovalSummary {
    return {
      status: qualification?.status ?? "NONE",
      approved: this.isApprovedBooster(qualification),
    };
  },

  buildAccountAccessPanel(qualification: BoosterQualificationRecord | null): AccountAccessPanel {
    return {
      ...this.summarize(qualification),
      qualificationId: qualification?.id ?? null,
      notes: qualification?.notes ?? null,
      discordTicketUrl: getDiscordBoosterTicketUrl(),
      selfRequestDisabled: true,
    };
  },

  async grant(
    admin: AuthenticatedUser,
    input: { userId: string; notes?: string },
  ): Promise<BoosterQualificationRecord> {
    assertCanReviewBoosterAccess(admin);

    const target = await userRepository.findById(input.userId);
    if (!target) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }

    const existing = await boosterQualificationRepository.findByUserId(input.userId);
    if (existing?.status === "APPROVED") {
      throw new DomainError(
        "BOOSTER_ACCESS_ALREADY_APPROVED",
        "This user is already an approved booster.",
      );
    }

    const now = new Date().toISOString();
    const notes = input.notes?.trim() || "Reviewed through Discord";

    if (!existing) {
      try {
        const created = await boosterQualificationRepository.create({
          id: crypto.randomUUID(),
          userId: input.userId,
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
          message: `Granted Booster access to ${target.name}.`,
        });
        return created;
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new DomainError(
            "BOOSTER_ACCESS_ALREADY_APPROVED",
            "This user is already an approved booster.",
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
      message: `Granted Booster access to ${target.name}.`,
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
      message: `Revoked Booster access from ${targetName}.`,
    });
    const updated = await boosterQualificationRepository.findById(qualification.id);
    if (!updated) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster qualification was not found.", 404);
    }
    return updated;
  },

  /**
   * Legacy approve bridge: ensure the User's account-level qualification is APPROVED.
   * No-op when already APPROVED.
   */
  async ensureApproved(
    admin: AuthenticatedUser,
    input: { userId: string; notes?: string },
  ): Promise<BoosterQualificationRecord> {
    assertCanReviewBoosterAccess(admin);
    const existing = await boosterQualificationRepository.findByUserId(input.userId);
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
  const haystack = [row.userName, row.grantedByName, row.notes]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
  return haystack.includes(query);
}
