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
 * Account roles are hierarchical platform permissions:
 * OWNER > ADMIN > RAID_LEAD > USER — each level inherits everything below it.
 * BOOSTER / LOOTBUDDY are run participation types and are intentionally absent here.
 * Check authority through these helpers, never with a literal role comparison.
 */
export function hasOwnerAccess(role: AccountRole): boolean {
  return role === "OWNER";
}

export function hasAdminAccess(role: AccountRole): boolean {
  return role === "ADMIN" || hasOwnerAccess(role);
}

export function hasRaidLeadAccess(role: AccountRole): boolean {
  return role === "RAID_LEAD" || hasAdminAccess(role);
}

/**
 * Boosting Roles (User.isBooster / User.isLootbuddy) are persistent account-level
 * capabilities, not per-run roster actions and never an accountRole.
 * RAID_LEAD may see them on roster tools but cannot grant or revoke them.
 */
export function canManageBoostingRoles(role: AccountRole): boolean {
  return hasAdminAccess(role);
}

export function assertCanManageBoostingRoles(user: AuthenticatedUser): void {
  if (!canManageBoostingRoles(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to manage boosting roles.", 403);
  }
}

/** Reviewing historical BoosterAccess requests follows the same ADMIN-level gate. */
export function canReviewBoosterAccess(role: AccountRole): boolean {
  return canManageBoostingRoles(role);
}

export function assertCanReviewBoosterAccess(user: AuthenticatedUser): void {
  if (!canReviewBoosterAccess(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to review booster requests.", 403);
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

/** Admin-level (ADMIN / OWNER) user directory and account-role administration. */
export function canManageUsers(role: AccountRole): boolean {
  return hasAdminAccess(role);
}

export function assertCanManageUsers(user: AuthenticatedUser): void {
  if (!canManageUsers(user.accountRole)) {
    throw new DomainError(
      "USER_MANAGEMENT_FORBIDDEN",
      "Admin permission is required to manage users.",
      403,
    );
  }
}

/** Admin-level (ADMIN / OWNER) Character Operations: all-character view and admin sync controls. */
export function canManageCharacterOperations(role: AccountRole): boolean {
  return hasAdminAccess(role);
}

export function assertCanManageCharacterOperations(user: AuthenticatedUser): void {
  if (!canManageCharacterOperations(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Admin permission is required for character operations.", 403);
  }
}

export type ManagementNavItem = {
  href: string;
  label: string;
  module: "overview" | "runs" | "templates" | "boosting-roles" | "users" | "characters";
};

/**
 * Management sub-navigation by account role.
 * Hidden links are not authorization — routes still enforce server-side.
 */
export function getManagementNavItems(role: AccountRole): ManagementNavItem[] {
  if (!canAccessManagement(role)) {
    return [];
  }
  const items: ManagementNavItem[] = [
    { href: "/manage", label: "Overview", module: "overview" },
    { href: "/manage/runs", label: "Runs", module: "runs" },
  ];
  if (hasAdminAccess(role)) {
    items.push(
      { href: "/manage/templates", label: "Templates", module: "templates" },
      { href: "/manage/boosting-roles", label: "Boosting Roles", module: "boosting-roles" },
      { href: "/manage/users", label: "Users", module: "users" },
      { href: "/manage/characters", label: "Characters", module: "characters" },
    );
  }
  return items;
}

export function isManagementNavActive(pathname: string, href: string): boolean {
  if (href === "/manage") {
    return pathname === "/manage";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * RAID_LEAD may manage only assigned runs. ADMIN (and OWNER) may manage every run.
 * Account role still has to be RAID_LEAD or above — being listed as raidLeadId
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
    throw new DomainError("RUN_NOT_MANAGEABLE", "You cannot manage this run.", 403);
  }
}

/**
 * Run Consumables Audit (post-run Warcraft Logs consumable/death facts,
 * including refresh). Deliberately the Run-management rule: ADMIN / OWNER on
 * every Run, RAID_LEAD only on Runs they lead, never a USER — so granting it
 * can never widen a Raid Lead's Run access.
 */
export function canViewRunConsumableAudit(
  user: AuthenticatedUser,
  run: { raidLeadId: string },
): boolean {
  return canManageRun(user, run);
}

export function assertCanViewRunConsumableAudit(
  user: AuthenticatedUser,
  run: { raidLeadId: string },
): void {
  if (!canViewRunConsumableAudit(user, run)) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Raid lead or admin permission for this run is required.",
      403,
    );
  }
}

export function isEligibleRaidLead(user: {
  accountRole: AccountRole;
  accountStatus: AccountStatus;
}): boolean {
  return user.accountStatus === "ACTIVE" && hasRaidLeadAccess(user.accountRole);
}
