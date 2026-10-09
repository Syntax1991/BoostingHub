import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageBoostingRoles } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import type { BoostingRole } from "@/models/enums";
import type { BoostingAccessGrant, BoostingRoles } from "@/models/records";
import { activityRepository } from "@/repositories/activity.repository";
import { userRepository } from "@/repositories/user.repository";

export type { BoostingAccessGrant, BoostingRoles };

/**
 * Central Booster access: manual grant OR Discord Raid Booster role.
 * Lootbuddy never contributes. ADMIN / OWNER have no bypass.
 */
export function hasEffectiveBoosterAccess(
  roles: { isBooster?: boolean; discordRaidBooster?: boolean } | null | undefined,
): BoostingAccessGrant {
  const manual = roles?.isBooster === true;
  const discord = roles?.discordRaidBooster === true;
  return { granted: manual || discord, manual, discord };
}

/**
 * Central Lootbuddy access: manual grant OR Discord Lootbuddy role.
 * Raid Booster never contributes.
 */
export function hasEffectiveLootbuddyAccess(
  roles: { isLootbuddy?: boolean; discordLootbuddy?: boolean } | null | undefined,
): BoostingAccessGrant {
  const manual = roles?.isLootbuddy === true;
  const discord = roles?.discordLootbuddy === true;
  return { granted: manual || discord, manual, discord };
}

/**
 * The single Booster-access check used by signup / roster / Auto Build.
 * Reads effective access (manual ∨ Discord Raid Booster).
 * Callers that already hydrate `ownerIsBooster` as the effective OR may pass
 * `{ isBooster: ownerIsBooster }` alone.
 */
export function isApprovedBooster(
  roles: { isBooster?: boolean; discordRaidBooster?: boolean } | null | undefined,
): boolean {
  return hasEffectiveBoosterAccess(roles).granted;
}

/** Display helper for admin source labels (no raw role IDs). */
export function boosterAccessSourceLabel(grant: BoostingAccessGrant): string | null {
  if (!grant.granted) return null;
  if (grant.manual && grant.discord) return "Manual + Discord";
  if (grant.discord) return "Discord · Raid Booster";
  return "Manual";
}

export function lootbuddyAccessSourceLabel(grant: BoostingAccessGrant): string | null {
  if (!grant.granted) return null;
  if (grant.manual && grant.discord) return "Manual + Discord";
  if (grant.discord) return "Discord · Lootbuddy";
  return "Manual";
}

const ROLE_LABEL: Record<BoostingRole, string> = { BOOSTER: "Booster", LOOTBUDDY: "Lootbuddy" };

const ACTIVITY_TYPE: Record<BoostingRole, { granted: string; revoked: string }> = {
  BOOSTER: { granted: "BOOSTER_GRANTED", revoked: "BOOSTER_REVOKED" },
  LOOTBUDDY: { granted: "LOOTBUDDY_GRANTED", revoked: "LOOTBUDDY_REVOKED" },
};

function holdsManual(roles: BoostingRoles, role: BoostingRole): boolean {
  return role === "BOOSTER" ? roles.isBooster : roles.isLootbuddy;
}

/**
 * Boosting Roles (Booster, Lootbuddy) are independent operational capabilities
 * on the User — never an accountRole, never stored on a Character. Only
 * ADMIN / OWNER may change the *manual* flags, and only through these
 * explicit operations. Discord-derived grants are never written here.
 */
export const boostingRoleService = {
  /**
   * Grants or revokes one *manual* Boosting Role. Setting a role to the state
   * it already has is a no-op (no write, no audit event). Discord grants are
   * untouched.
   */
  async setRole(
    admin: AuthenticatedUser,
    input: { userId: string; role: BoostingRole; enabled: boolean; reason?: string },
  ): Promise<{ changed: boolean; targetName: string; roles: BoostingRoles }> {
    assertCanManageBoostingRoles(admin);

    const target = await userRepository.findById(input.userId);
    const current = target ? await userRepository.findBoostingRoles(input.userId) : null;
    if (!target || !current) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }

    if (holdsManual(current, input.role) === input.enabled) {
      return { changed: false, targetName: target.name, roles: current };
    }

    await userRepository.setBoostingRole(input.userId, input.role, input.enabled);

    const label = ROLE_LABEL[input.role];
    const verb = input.enabled ? `Granted the ${label} role to` : `Revoked the ${label} role from`;
    const reason = input.reason ? ` Reason: ${input.reason}` : "";
    await activityRepository.create({
      userId: admin.id,
      type: input.enabled ? ACTIVITY_TYPE[input.role].granted : ACTIVITY_TYPE[input.role].revoked,
      message: `${verb} ${target.name}.${reason} targetUserId=${target.id}`,
    });

    const roles: BoostingRoles =
      input.role === "BOOSTER"
        ? { ...current, isBooster: input.enabled }
        : { ...current, isLootbuddy: input.enabled };
    return { changed: true, targetName: target.name, roles };
  },
};
