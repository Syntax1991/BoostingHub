import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanReviewBoosterAccess } from "@/auth/authorization";
import type { BoosterAccessMatch, BoosterAccessRecord } from "@/models/records";
import type { BoosterAccessStatus, CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { RAID_DIFFICULTIES } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { CLASS_LABELS, CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { isRoleValidForClass, rolesForClass } from "@/lib/wow-specializations";
import { activityRepository } from "@/repositories/activity.repository";
import {
  boosterAccessRepository,
  type BoosterAccessAdminRecord,
} from "@/repositories/booster-access.repository";
import { characterRepository } from "@/repositories/character.repository";
import {
  assertBoosterAccessTransition,
  canRequestFromStatus,
  isApprovedAccessStatus,
} from "@/services/booster-access-state";

export type { BoosterAccessMatch, BoosterAccessRecord };

export type BoosterAccessCell = {
  role: CharacterRole;
  difficulty: RaidDifficulty;
  status: BoosterAccessStatus | "NONE";
  accessId: string | null;
  notes: string | null;
  canRequest: boolean;
};

export type CharacterAccessPanel = {
  roles: CharacterRole[];
  difficulties: readonly RaidDifficulty[];
  cells: BoosterAccessCell[];
  canSubmitRequests: boolean;
  inactiveHint: string | null;
};

export type AdminAccessFilters = {
  status?: BoosterAccessStatus | "ALL";
  difficulty?: RaidDifficulty;
  role?: CharacterRole;
  query?: string;
};

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

function accessLabel(wowClass: WowClass, role: CharacterRole, difficulty: RaidDifficulty) {
  return `${CLASS_LABELS[wowClass]} ${CHARACTER_ROLE_LABELS[role]} ${DIFFICULTY_LABELS[difficulty]}`;
}

function characterLabel(character: { name: string; realm: string }) {
  return `${character.name}-${character.realm}`;
}

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You can only request booster access for your own characters.", 403);
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

function assertCharacterActive(isActive: boolean) {
  if (!isActive) {
    throw new DomainError(
      "CHARACTER_INACTIVE",
      "Reactivate this character before requesting or approving booster access.",
    );
  }
}

/**
 * BoosterAccess is account-level platform eligibility scoped by
 * user + class + role + difficulty. Characters consume matching approvals;
 * they do not own BoosterAccess rows. Heroic never implies Normal or Mythic.
 */
export const boosterAccessService = {
  isApprovedFor(
    records: BoosterAccessMatch[],
    wowClass: WowClass,
    role: CharacterRole,
    difficulty: RaidDifficulty,
  ): boolean {
    return records.some(
      (record) =>
        isApprovedAccessStatus(record.status) &&
        record.wowClass === wowClass &&
        record.role === role &&
        record.difficulty === difficulty,
    );
  },

  summarize(records: BoosterAccessMatch[]) {
    const approved = records.filter((record) => record.status === "APPROVED");
    return {
      approvedCount: approved.length,
      pendingCount: records.filter((record) => record.status === "PENDING").length,
      rejectedCount: records.filter((record) => record.status === "REJECTED").length,
      revokedCount: records.filter((record) => record.status === "REVOKED").length,
      approvals: approved.map((record) => ({
        wowClass: record.wowClass,
        role: record.role,
        difficulty: record.difficulty,
      })),
    };
  },

  buildCharacterAccessPanel(character: {
    wowClass: WowClass;
    isActive: boolean;
    boosterAccess: BoosterAccessRecord[];
  }): CharacterAccessPanel {
    const roles = rolesForClass(character.wowClass);
    const cells: BoosterAccessCell[] = [];

    for (const difficulty of RAID_DIFFICULTIES) {
      for (const role of roles) {
        const existing = character.boosterAccess.find(
          (record) =>
            record.wowClass === character.wowClass &&
            record.role === role &&
            record.difficulty === difficulty,
        );
        const status = existing?.status ?? "NONE";
        cells.push({
          role,
          difficulty,
          status,
          accessId: existing?.id ?? null,
          notes: existing?.notes ?? null,
          canRequest: character.isActive && canRequestFromStatus(existing?.status ?? null),
        });
      }
    }

    return {
      roles,
      difficulties: RAID_DIFFICULTIES,
      cells,
      canSubmitRequests: character.isActive,
      inactiveHint: character.isActive
        ? null
        : "Reactivate this character before requesting new access.",
    };
  },

  async requestAccess(
    user: AuthenticatedUser,
    input: { characterId: string; role: CharacterRole; difficulty: RaidDifficulty },
  ) {
    const character = await loadOwnedCharacter(user, input.characterId);
    assertCharacterActive(character.isActive);
    assertRoleForClass(character.wowClass, input.role);

    const existing = await boosterAccessRepository.findExact(
      user.id,
      character.wowClass,
      input.role,
      input.difficulty,
    );

    if (existing?.status === "PENDING") {
      throw new DomainError("BOOSTER_ACCESS_ALREADY_PENDING", "That access request is already pending review.");
    }
    if (existing?.status === "APPROVED") {
      throw new DomainError("BOOSTER_ACCESS_ALREADY_APPROVED", "That combination is already approved.");
    }

    const label = accessLabel(character.wowClass, input.role, input.difficulty);

    if (!existing) {
      try {
        const created = await boosterAccessRepository.create({
          id: crypto.randomUUID(),
          userId: user.id,
          characterId: character.id,
          wowClass: character.wowClass,
          role: input.role,
          difficulty: input.difficulty,
          status: "PENDING",
          notes: null,
          approvedAt: null,
          approvedById: null,
          reviewedAt: null,
          reviewedById: null,
        });
        await activityRepository.create({
          userId: user.id,
          type: "BOOSTER_ACCESS_REQUESTED",
          message: `Requested ${label} for ${characterLabel(character)}.`,
        });
        return created;
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new DomainError(
            "BOOSTER_ACCESS_ALREADY_PENDING",
            "That access request is already pending review.",
          );
        }
        throw error;
      }
    }

    assertBoosterAccessTransition(existing.status, "PENDING");
    await boosterAccessRepository.updateStatus(existing.id, {
      status: "PENDING",
      characterId: character.id,
      notes: null,
      approvedAt: null,
      approvedById: null,
      reviewedAt: null,
      reviewedById: null,
    });
    await activityRepository.create({
      userId: user.id,
      type: "BOOSTER_ACCESS_REQUESTED",
      message: `Requested ${label} for ${characterLabel(character)}.`,
    });
    const reopened = await boosterAccessRepository.findById(existing.id);
    if (!reopened) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster access was not found.", 404);
    }
    return reopened;
  },

  async approveAccess(admin: AuthenticatedUser, accessId: string) {
    assertCanReviewBoosterAccess(admin);
    const access = await boosterAccessRepository.findById(accessId);
    if (!access) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster access was not found.", 404);
    }
    assertBoosterAccessTransition(access.status, "APPROVED");
    assertRoleForClass(access.wowClass, access.role);

    // characterId is request context only. Approval is account-level and must not
    // require the requesting Character to still be active.
    let activityTarget = accessLabel(access.wowClass, access.role, access.difficulty);
    if (access.characterId) {
      const character = await characterRepository.findById(access.characterId);
      if (character) {
        activityTarget = `${activityTarget} (requested via ${characterLabel(character)})`;
      }
    }

    const now = new Date().toISOString();
    await boosterAccessRepository.updateStatus(access.id, {
      status: "APPROVED",
      notes: null,
      approvedAt: now,
      approvedById: admin.id,
      reviewedAt: now,
      reviewedById: admin.id,
    });
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_APPROVED",
      message: `Approved ${activityTarget}.`,
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

  async revokeAccess(admin: AuthenticatedUser, accessId: string, reason?: string) {
    assertCanReviewBoosterAccess(admin);
    const access = await boosterAccessRepository.findById(accessId);
    if (!access) {
      throw new DomainError("BOOSTER_ACCESS_NOT_FOUND", "Booster access was not found.", 404);
    }
    assertBoosterAccessTransition(access.status, "REVOKED");

    const now = new Date().toISOString();
    await boosterAccessRepository.updateStatus(access.id, {
      status: "REVOKED",
      notes: reason ?? null,
      approvedAt: access.approvedAt,
      approvedById: access.approvedById,
      reviewedAt: now,
      reviewedById: admin.id,
    });
    await activityRepository.create({
      userId: admin.id,
      type: "BOOSTER_ACCESS_REVOKED",
      message: `Revoked ${accessLabel(access.wowClass, access.role, access.difficulty)}.`,
    });
  },

  async listAdminAccessRequests(admin: AuthenticatedUser, filters: AdminAccessFilters = {}) {
    assertCanReviewBoosterAccess(admin);
    const status = filters.status && filters.status !== "ALL" ? filters.status : undefined;
    const rows = await boosterAccessRepository.listAdmin({
      status,
      difficulty: filters.difficulty,
      role: filters.role,
    });
    const query = filters.query?.trim().toLocaleLowerCase("en-US");
    if (!query) {
      return rows;
    }
    return rows.filter((row) => matchesAdminQuery(row, query));
  },
};

function matchesAdminQuery(row: BoosterAccessAdminRecord, query: string) {
  const haystack = [row.userName, row.characterName, row.realm].filter(Boolean).join(" ").toLocaleLowerCase("en-US");
  return haystack.includes(query);
}
