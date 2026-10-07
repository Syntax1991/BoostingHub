"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { boostingRoleService } from "@/services/boosting-role.service";
import { setBoostingRoleSchema } from "@/validators/boosting-roles";

const ROLE_LABEL = { BOOSTER: "Booster", LOOTBUDDY: "Lootbuddy" } as const;

/**
 * Grant or revoke one Boosting Role (Booster / Lootbuddy) on a User.
 * ADMIN / OWNER only; never touches accountRole.
 */
export async function setBoostingRoleAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = setBoostingRoleSchema.parse(input);
    const result = await boostingRoleService.setRole(admin, parsed);

    revalidatePath("/manage");
    revalidatePath("/manage/users");
    revalidatePath(`/manage/users/${parsed.userId}`);
    revalidatePath("/manage/characters");
    revalidatePath("/characters");
    revalidatePath("/dashboard");
    revalidatePath("/profile");
    revalidatePath("/runs");

    const label = ROLE_LABEL[parsed.role];
    const message = !result.changed
      ? `${result.targetName} ${parsed.enabled ? "already has" : "does not have"} the ${label} role.`
      : `${label} role ${parsed.enabled ? "granted to" : "revoked from"} ${result.targetName}.`;
    return { ok: true, message };
  } catch (error) {
    return mapActionError(error);
  }
}
