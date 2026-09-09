import type { AccountRole, AccountStatus } from "@/models/enums";
import { DomainError } from "@/lib/errors";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  accountRole: AccountRole;
  accountStatus: AccountStatus;
};

/**
 * Account roles are hierarchical platform permissions.
 * BOOSTER / LOOTBUDDY are run participation types and are intentionally absent here.
 */
export function hasRaidLeadAccess(role: AccountRole): boolean {
  return role === "RAID_LEAD" || role === "ADMIN";
}

export function hasAdminAccess(role: AccountRole): boolean {
  return role === "ADMIN";
}

/**
 * BoosterAccess is a persistent platform qualification, not a per-run roster action.
 * RAID_LEAD may see access on roster tools but cannot globally approve/reject/revoke.
 * A later BOOSTER_ACCESS_MANAGER permission may replace this ADMIN-only gate.
 */
export function canReviewBoosterAccess(role: AccountRole): boolean {
  return hasAdminAccess(role);
}

export function assertCanReviewBoosterAccess(user: AuthenticatedUser): void {
  if (!canReviewBoosterAccess(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to review booster access.", 403);
  }
}

export function assertActive(user: AuthenticatedUser): void {
  if (user.accountStatus !== "ACTIVE") {
    throw new DomainError("ACCOUNT_DISABLED", "This account is disabled.", 403);
  }
}

export function canAccessManagement(role: AccountRole): boolean {
  return hasRaidLeadAccess(role);
}

/**
 * RAID_LEAD may manage only assigned runs. ADMIN may manage every run.
 * Account role still has to be RAID_LEAD or ADMIN — being listed as raidLeadId
 * does not grant a USER roster tools.
 */
export function canManageRun(
  user: AuthenticatedUser,
  run: { raidLeadId: string },
): boolean {
  if (!canAccessManagement(user.accountRole)) {
    return false;
  }
  if (hasAdminAccess(user.accountRole)) {
    return true;
  }
  return user.id === run.raidLeadId;
}

export function assertCanManageRun(user: AuthenticatedUser, run: { raidLeadId: string }): void {
  if (!canManageRun(user, run)) {
    throw new DomainError("RUN_NOT_MANAGEABLE", "You cannot manage the roster for this run.", 403);
  }
}
