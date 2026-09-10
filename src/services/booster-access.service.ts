import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanReviewBoosterAccess } from "@/auth/authorization";
import type { BoosterAccessMatch, BoosterAccessRecord } from "@/models/records";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { CLASS_LABELS, CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { isRoleValidForClass } from "@/lib/wow-specializations";
import { activityRepository } from "@/repositories/activity.repository";
import {
  boosterAccessRepository,
  type BoosterAccessAdminRecord,
} from "@/repositories/booster-access.repository";
import { characterRepository } from "@/repositories/character.repository";
import { assertBoosterAccessTransition } from "@/services/booster-access-state";
import {
  boosterQualificationService,
  type AdminQualificationRow,
} from "@/services/booster-qualification.service";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import type { BoosterQualificationStatus } from "@/models/enums";

export type { BoosterAccessMatch, BoosterAccessRecord };

export type AdminAccessFilters = {
  view?: "qualifications" | "legacy";
  status?: BoosterQualificationStatus | "ALL";
  difficulty?: RaidDifficulty;
  role?: CharacterRole;
  query?: string;
  userId?: string;
};

export type AdminAccessListResult = {
  view: "qualifications" | "legacy";
  legacyPendingCount: number;
  approvedQualificationCount: number;
  qualifications: AdminQualificationRow[];
  legacyRequests: BoosterAccessAdminRecord[];
};

function accessLabel(wowClass: WowClass, role: CharacterRole, difficulty: RaidDifficulty) {
  return `${CLASS_LABELS[wowClass]} ${CHARACTER_ROLE_LABELS[role]} ${DIFFICULTY_LABELS[difficulty]}`;
}

function characterLabel(character: { name: string; realm: string }) {
  return `${character.name}-${character.realm}`;
}

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError(
      "CHARACTER_NOT_OWNED",
      "You can only request booster access for your own characters.",
      403,
    );
  }
}

async function loadOwnedCharacter(user: AuthenticatedUser, characterId: string) {
  const character = await characterRepository.findById(characterId);
  if (!character) {
    throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
  }
  assertOwned(user, character);
  return character;
}

function assertRoleForClass(wowClass: WowClass, role: CharacterRole) {
  if (!isRoleValidForClass(wowClass, role)) {
    throw new DomainError(
      "BOOSTER_ACCESS_ROLE_INVALID",
      "That role is not valid for this character's class.",
    );
  }
}

/**
 * Legacy BoosterAccess is historical PENDING/APPROVED/REJECTED/REVOKED Class/Role
 * request history. Current eligibility lives on BoosterQualification (User + Difficulty).
 *
 * New self-service requests are disabled. Applications are reviewed in Discord;
 * ADMIN grants qualifications directly after external review.
 */
export const boosterAccessService = {
  /**
   * @deprecated Prefer boosterQualificationService.grant
   */
  async grantAccess(
    admin: AuthenticatedUser,
    input: { userId: string; difficulty: RaidDifficulty; notes?: string },
  ) {
    return boosterQualificationService.grant(admin, input);
  },

  /**
   * Self-service creation of PENDING BoosterAccess is permanently disabled.
   * Historical PENDING rows remain; ADMIN may still review them.
   */
  async requestAccess(
    user: AuthenticatedUser,
    input: { characterId: string; role: CharacterRole; difficulty: RaidDifficulty },
  ): Promise<never> {
    await loadOwnedCharacter(user, input.characterId);
    throw new DomainError(
      "BOOSTER_ACCESS_SELF_REQUEST_DISABLED",
      "Booster applications are reviewed through Discord. An admin grants access after review.",
      403,
    );
  },

  async approveAccess(admin: AuthenticatedUser, accessId: string) {
    assertCanReviewBoosterAccess(admin);
    const access = await boosterAccessRepository.findById(accessId);
    if (!access) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster access was not found.", 404);
    }
    assertBoosterAccessTransition(access.status, "APPROVED");
    assertRoleForClass(access.wowClass, access.role);

    const siblings = await boosterAccessRepository.listPendingByUserDifficulty(
      access.userId,
      access.difficulty,
    );

    const now = new Date().toISOString();
    for (const sibling of siblings) {
      await boosterAccessRepository.updateStatus(sibling.id, {
        status: "APPROVED",
        notes: sibling.id === access.id ? null : sibling.notes,
        approvedAt: now,
        approvedById: admin.id,
        reviewedAt: now,
        reviewedById: admin.id,
      });
    }

    await boosterQualificationService.ensureApproved(admin, {
      userId: access.userId,
      difficulty: access.difficulty,
      notes: `Legacy approve bridge for ${accessLabel(access.wowClass, access.role, access.difficulty)}`,
    });

    let activityTarget = accessLabel(access.wowClass, access.role, access.difficulty);
    if (access.characterId) {
      const character = await characterRepository.findById(access.characterId);
      if (character) {
        activityTarget = `${activityTarget} (requested via ${characterLabel(character)})`;
      }
    }
    const siblingNote =
      siblings.length > 1
        ? ` Resolved ${siblings.length} PENDING ${DIFFICULTY_LABELS[access.difficulty]} requests.`
        : "";
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_APPROVED",
      message: `Approved ${activityTarget}.${siblingNote}`,
    });
  },

  async rejectAccess(admin: AuthenticatedUser, accessId: string, reason?: string) {
    assertCanReviewBoosterAccess(admin);
    const access = await boosterAccessRepository.findById(accessId);
    if (!access) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster access was not found.", 404);
    }
    assertBoosterAccessTransition(access.status, "REJECTED");

    const now = new Date().toISOString();
    await boosterAccessRepository.updateStatus(access.id, {
      status: "REJECTED",
      notes: reason ?? null,
      approvedAt: null,
      approvedById: null,
      reviewedAt: now,
      reviewedById: admin.id,
    });
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_REJECTED",
      message: `Rejected ${accessLabel(access.wowClass, access.role, access.difficulty)}.`,
    });
  },

  /**
   * Revoke current eligibility via BoosterQualification.
   */
  async revokeAccess(admin: AuthenticatedUser, qualificationId: string, reason?: string) {
    return boosterQualificationService.revoke(admin, qualificationId, reason);
  },

  async listAdminAccessRequests(
    admin: AuthenticatedUser,
    filters: AdminAccessFilters = {},
  ): Promise<AdminAccessListResult> {
    assertCanReviewBoosterAccess(admin);
    const view = filters.view ?? "qualifications";
    const statusCounts = await boosterAccessRepository.countByStatus();
    const legacyPendingCount = statusCounts.PENDING;
    const approvedQualificationCount = await boosterQualificationRepository.countApproved();

    if (view === "legacy") {
      let legacyRequests = await boosterAccessRepository.listAdmin({
        status: "PENDING",
        difficulty: filters.difficulty,
        role: filters.role,
      });
      if (filters.userId) {
        legacyRequests = legacyRequests.filter((row) => row.userId === filters.userId);
      }
      const query = filters.query?.trim().toLocaleLowerCase("en-US");
      if (query) {
        legacyRequests = legacyRequests.filter((row) => matchesLegacyQuery(row, query));
      }
      return {
        view,
        legacyPendingCount,
        approvedQualificationCount,
        qualifications: [],
        legacyRequests,
      };
    }

    const qualifications = await boosterQualificationService.listAdminQualifications(admin, {
      status: filters.status,
      difficulty: filters.difficulty,
      query: filters.query,
      userId: filters.userId,
    });

    return {
      view,
      legacyPendingCount,
      approvedQualificationCount,
      qualifications,
      legacyRequests: [],
    };
  },
};

function matchesLegacyQuery(row: BoosterAccessAdminRecord, query: string) {
  const haystack = [
    row.userName,
    row.characterName,
    row.realm,
    CLASS_LABELS[row.wowClass],
    CHARACTER_ROLE_LABELS[row.role],
    DIFFICULTY_LABELS[row.difficulty],
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
  return haystack.includes(query);
}
