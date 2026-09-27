import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanReviewBoosterAccess } from "@/auth/authorization";
import type { BoosterAccessRecord } from "@/models/records";
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
import { boostingRoleService } from "@/services/boosting-role.service";

export type { BoosterAccessRecord };

export type LegacyRequestFilters = {
  /** Filters historical requests by what was requested at the time. */
  difficulty?: RaidDifficulty;
  role?: CharacterRole;
  query?: string;
  userId?: string;
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
 * HISTORICAL REQUEST vs CURRENT CAPABILITY: BoosterAccess is historical
 * PENDING/APPROVED/REJECTED/REVOKED Class/Role request history; its difficulty
 * records what was requested at the time and is never read for eligibility.
 * The current capability is User.isBooster (see boostingRoleService).
 *
 * New self-service requests are disabled. Applications are reviewed in Discord;
 * ADMIN grants the Booster role directly after external review.
 */
export const boosterAccessService = {
  /**
   * Self-service creation of PENDING BoosterAccess is permanently disabled.
   * Historical PENDING rows remain; ADMIN may still review them.
   */
  async requestAccess(user: AuthenticatedUser, input: { characterId: string }): Promise<never> {
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

    // Account-level approval covers every PENDING legacy request of this User.
    const siblings = await boosterAccessRepository.listPendingByUser(access.userId);

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

    // Approving a historical request grants the account-level Booster role
    // (a no-op when the User already holds it). Difficulty is not carried over.
    await boostingRoleService.setRole(admin, { userId: access.userId, role: "BOOSTER", enabled: true });

    let activityTarget = accessLabel(access.wowClass, access.role, access.difficulty);
    if (access.characterId) {
      const character = await characterRepository.findById(access.characterId);
      if (character) {
        activityTarget = `${activityTarget} (requested via ${characterLabel(character)})`;
      }
    }
    const siblingNote =
      siblings.length > 1
        ? ` Resolved ${siblings.length} PENDING requests.`
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

  /** PENDING historical requests awaiting review (the only ones still actionable). */
  async listLegacyRequests(
    admin: AuthenticatedUser,
    filters: LegacyRequestFilters = {},
  ): Promise<{ pendingCount: number; requests: BoosterAccessAdminRecord[] }> {
    assertCanReviewBoosterAccess(admin);
    const statusCounts = await boosterAccessRepository.countByStatus();
    let requests = await boosterAccessRepository.listAdmin({
      status: "PENDING",
      difficulty: filters.difficulty,
      role: filters.role,
    });
    if (filters.userId) {
      requests = requests.filter((row) => row.userId === filters.userId);
    }
    const query = filters.query?.trim().toLocaleLowerCase("en-US");
    if (query) {
      requests = requests.filter((row) => matchesLegacyQuery(row, query));
    }
    return { pendingCount: statusCounts.PENDING, requests };
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
