import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageBoostingRoles } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import type { BoostingRole } from "@/models/enums";
import type { BoostingRoles } from "@/models/records";
import { activityRepository } from "@/repositories/activity.repository";
import { userRepository } from "@/repositories/user.repository";

export type { BoostingRoles };

/**
 * The single Booster-access check: an approved Booster may boost Normal, Heroic
 * and Mythic Runs alike — Booster is never scoped by raid difficulty. ADMIN and
 * OWNER have no bypass; accountRole plays no part here.
 */
export function isApprovedBooster(roles: Pick<BoostingRoles, "isBooster"> | null | undefined): boolean {
  return roles?.isBooster === true;
}

const ROLE_LABEL: Record<BoostingRole, string> = { BOOSTER: "Booster", LOOTBUDDY: "Lootbuddy" };

const ACTIVITY_TYPE: Record<BoostingRole, { granted: string; revoked: string }> = {
  BOOSTER: { granted: "BOOSTER_GRANTED", revoked: "BOOSTER_REVOKED" },
  LOOTBUDDY: { granted: "LOOTBUDDY_GRANTED", revoked: "LOOTBUDDY_REVOKED" },
};

function holds(roles: BoostingRoles, role: BoostingRole): boolean {
  return role === "BOOSTER" ? roles.isBooster : roles.isLootbuddy;
}

/**
 * Boosting Roles (Booster, Lootbuddy) are independent operational capabilities
 * on the User — never an accountRole, never stored on a Character. Only
 * ADMIN / OWNER may change them, and only through these explicit operations.
 */
export const boostingRoleService = {
  /**
   * Grants or revokes one Boosting Role. Setting a role to the state it already
   * has is a no-op (no write, no audit event) so repeated clicks stay harmless.
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

    if (holds(current, input.role) === input.enabled) {
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
