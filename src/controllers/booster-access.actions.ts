"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { boosterAccessService } from "@/services/booster-access.service";
import { boosterAccessIdSchema, rejectBoosterAccessSchema } from "@/validators/booster-access";

function revalidateAccessSurfaces(characterId?: string | null) {
  revalidatePath("/characters");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/runs");
  revalidatePath("/manage");
  revalidatePath("/manage/users");
  if (characterId) {
    revalidatePath(`/characters/${characterId}`);
  }
}

export async function approveBoosterAccessAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = boosterAccessIdSchema.parse(input);
    await boosterAccessService.approveAccess(admin, parsed.accessId);
    revalidateAccessSurfaces();
    revalidatePath("/characters");
    return { ok: true, message: "Request approved — Booster role granted." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function rejectBoosterAccessAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = rejectBoosterAccessSchema.parse(input);
    await boosterAccessService.rejectAccess(admin, parsed.accessId, parsed.reason);
    revalidateAccessSurfaces();
    return { ok: true, message: "Request rejected." };
  } catch (error) {
    return mapActionError(error);
  }
}
