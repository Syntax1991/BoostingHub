"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { userManagementService } from "@/services/user-management.service";
import { changeAccountRoleSchema } from "@/validators/user-management";

export async function changeAccountRoleAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = changeAccountRoleSchema.parse(input);
    const result = await userManagementService.changeAccountRole(admin, parsed);
    revalidatePath("/manage");
    revalidatePath("/manage/users");
    revalidatePath(`/manage/users/${parsed.targetUserId}`);
    revalidatePath("/manage/runs");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: `Role updated to ${result.nextRole} for ${result.targetName}.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}
