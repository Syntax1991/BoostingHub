"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { boosterAccessService } from "@/services/booster-access.service";
import {
  boosterAccessIdSchema,
  rejectBoosterAccessSchema,
  requestBoosterAccessSchema,
  revokeBoosterAccessSchema,
} from "@/validators/booster-access";

function revalidateAccessSurfaces(characterId?: string | null) {
  revalidatePath("/characters");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/runs");
  revalidatePath("/manage/booster-access");
  if (characterId) {
    revalidatePath(`/characters/${characterId}`);
  }
}

/**
 * Request identity and class come from the session character, never the client.
 */
export async function requestBoosterAccessAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = requestBoosterAccessSchema.parse(input);
    await boosterAccessService.requestAccess(user, parsed);
    revalidateAccessSurfaces(parsed.characterId);
    return { ok: true, message: "Access request submitted." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function approveBoosterAccessAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = boosterAccessIdSchema.parse(input);
    await boosterAccessService.approveAccess(admin, parsed.accessId);
    revalidateAccessSurfaces();
    revalidatePath("/characters");
    return { ok: true, message: "Booster access approved." };
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
    return { ok: true, message: "Booster access rejected." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function revokeBoosterAccessAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = revokeBoosterAccessSchema.parse(input);
    await boosterAccessService.revokeAccess(admin, parsed.accessId, parsed.reason);
    revalidateAccessSurfaces();
    return { ok: true, message: "Booster access revoked." };
  } catch (error) {
    return mapActionError(error);
  }
}
