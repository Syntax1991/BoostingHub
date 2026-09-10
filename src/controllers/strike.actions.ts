"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { strikeService } from "@/services/strike.service";
import { addStrikeSchema, revokeStrikeSchema } from "@/validators/strike";

function revalidateStrikeSurfaces(input: { userId?: string; runId?: string | null }) {
  revalidatePath("/profile");
  revalidatePath("/manage/users");
  if (input.userId) {
    revalidatePath(`/manage/users/${input.userId}`);
  }
  if (input.runId) {
    revalidatePath(`/runs/${input.runId}`);
  }
}

export async function addStrikeAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = addStrikeSchema.parse(input);
    const created = await strikeService.create(user, parsed);
    revalidateStrikeSurfaces({ userId: created.userId, runId: created.runId });
    return { ok: true, message: "Strike added." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function revokeStrikeAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = revokeStrikeSchema.parse(input);
    const updated = await strikeService.revoke(user, parsed.strikeId, parsed.revokedReason);
    revalidateStrikeSurfaces({ userId: updated.userId, runId: updated.runId });
    return { ok: true, message: "Strike revoked." };
  } catch (error) {
    return mapActionError(error);
  }
}
