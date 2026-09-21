import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertCanManageUsers,
  hasRaidLeadAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { ROLE_LABELS } from "@/lib/labels";
import { defaultRaidBossTotal } from "@/lib/lockout-display";
import { getCurrentLockoutRaids, raidContentDisplayName } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { ACCOUNT_ROLES, type AccountRole } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { userRepository, type AdminUserListFilters } from "@/repositories/user.repository";
import { lockoutService } from "@/services/lockout.service";
import { strikeService } from "@/services/strike.service";

function isAccountRole(value: string): value is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/**
 * Account role administration. BOOSTER is never an account role.
 * Session authorization reloads User.accountRole from the database on each
 * trusted request, so role changes apply without session invalidation.
 */
export const userManagementService = {
  async listUsers(admin: AuthenticatedUser, filters: AdminUserListFilters = {}) {
    assertCanManageUsers(admin);
    return userRepository.listAdminUsers(filters);
  },

  async getUserDetail(admin: AuthenticatedUser, userId: string) {
    assertCanManageUsers(admin);
    const detail = await userRepository.findAdminUserDetail(userId);
    if (!detail) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }
    const strikes = await strikeService.listForUser(admin, userId);
    const currentRaids = getCurrentLockoutRaids();
    const currentRaidIds = new Set(currentRaids.map((raid) => raid.id));
    const currentLockoutRaids = currentRaids.map((raid) => ({
      id: raid.id,
      name: raidContentDisplayName(raid.id, raid.name),
    }));

    return {
      ...detail,
      strikes,
      currentLockoutRaids,
      characters: detail.characters.map((character) => {
        const currentReset = getRegionalWeeklyReset(character.region).resetIdentifier;
        const lockouts = lockoutService
          .summarize(
            character.lockouts.filter(
              (lockout) =>
                lockout.resetIdentifier === currentReset && currentRaidIds.has(lockout.raidId),
            ),
          )
          .map((lockout) => ({
            ...lockout,
            raidName: raidContentDisplayName(lockout.raidId, lockout.raidName),
            bossTotal: defaultRaidBossTotal(lockout.raidId),
            verified: true as const,
          }));

        return {
          id: character.id,
          name: character.name,
          realm: character.realm,
          region: character.region,
          wowClass: character.wowClass,
          specialization: character.specialization,
          primaryRole: character.primaryRole,
          itemLevel: character.itemLevel,
          isActive: character.isActive,
          blizzardLinked: character.blizzardLinked,
          currentReset,
          lockouts,
        };
      }),
    };
  },

  async changeAccountRole(
    admin: AuthenticatedUser,
    input: { targetUserId: string; nextRole: string },
  ) {
    assertCanManageUsers(admin);

    if (!isAccountRole(input.nextRole)) {
      throw new DomainError("INVALID_ACCOUNT_ROLE", "That account role is not supported.");
    }
    const nextRole = input.nextRole;

    const target = await userRepository.findById(input.targetUserId);
    if (!target) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }

    const previousRole = target.accountRole;
    if (previousRole === nextRole) {
      throw new DomainError(
        "ROLE_ALREADY_ASSIGNED",
        `${target.name} already has the ${ROLE_LABELS[nextRole]} role.`,
      );
    }

    const losingRaidLeadAccess =
      hasRaidLeadAccess(previousRole) && !hasRaidLeadAccess(nextRole);
    if (losingRaidLeadAccess) {
      const blockingRuns = await userRepository.listNonTerminalRunsForRaidLead(target.id);
      if (blockingRuns.length > 0) {
        const titles = blockingRuns
          .slice(0, 3)
          .map((run) => run.title)
          .join(", ");
        const more = blockingRuns.length > 3 ? ` (+${blockingRuns.length - 3} more)` : "";
        throw new DomainError(
          "ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS",
          `Reassign active runs before demoting ${target.name}: ${titles}${more}.`,
        );
      }
    }

    if (previousRole === "ADMIN" && nextRole !== "ADMIN") {
      const adminCount = await userRepository.countAdmins();
      if (adminCount <= 1) {
        throw new DomainError(
          "LAST_ADMIN_REQUIRED",
          "The platform must keep at least one Admin account.",
        );
      }
    }

    // Re-check last-admin immediately before persist to reduce concurrent demotion races.
    if (previousRole === "ADMIN" && nextRole !== "ADMIN") {
      const adminCount = await userRepository.countAdmins();
      if (adminCount <= 1) {
        throw new DomainError(
          "LAST_ADMIN_REQUIRED",
          "The platform must keep at least one Admin account.",
        );
      }
    }

    await userRepository.updateAccountRole(target.id, nextRole);

    await activityRepository.create({
      userId: admin.id,
      type: "ACCOUNT_ROLE_CHANGED",
      message: `Changed account role for ${target.name} (${ROLE_LABELS[previousRole]} → ${ROLE_LABELS[nextRole]}). targetUserId=${target.id}`,
    });

    return {
      targetUserId: target.id,
      targetName: target.name,
      previousRole,
      nextRole,
      selfDemotion: admin.id === target.id,
      stillEligibleRaidLead: isEligibleRaidLead({
        accountRole: nextRole,
        accountStatus: target.accountStatus,
      }),
    };
  },
};
