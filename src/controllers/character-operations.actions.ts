"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import {
  characterOperationsService,
  type BulkForceRefreshResult,
} from "@/services/character-operations.service";
import { adminCharacterSyncSchema } from "@/validators/character-operations";

/**
 * Admin Character Operations server actions. requireAdmin (hasAdminAccess —
 * ADMIN and OWNER) gates every action, and the service asserts again. The
 * target Character comes only from a validated id; its owner and eligibility
 * are resolved server-side. Results carry safe category labels only.
 */

function revalidateCharacter(characterId?: string) {
  revalidatePath("/manage");
  revalidatePath("/manage/characters");
  if (characterId) revalidatePath(`/manage/characters/${characterId}`);
  revalidatePath("/characters");
}

async function syncOne(input: unknown, force: boolean): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { characterId } = adminCharacterSyncSchema.parse(input);
    const outcome = await characterOperationsService.syncCharacter(admin, { characterId, force });
    revalidateCharacter(characterId);
    if (outcome.status === "SUCCEEDED") {
      return {
        ok: true,
        message: `${force ? "Force refreshed" : "Synced"} ${outcome.label}${outcome.lockoutSynced ? "" : " (lockouts not verified)"}.`,
      };
    }
    return { ok: false, code: "CHARACTER_SYNC_FAILED", message: `Sync failed: ${outcome.errorLabel}.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function adminSyncCharacterAction(input: unknown): Promise<ActionResult> {
  return syncOne(input, false);
}

export async function adminForceRefreshCharacterAction(input: unknown): Promise<ActionResult> {
  return syncOne(input, true);
}

export async function adminForceRefreshAllAction(): Promise<
  { ok: true; result: BulkForceRefreshResult } | { ok: false; code: string; message: string }
> {
  try {
    const admin = await requireAdmin();
    const result = await characterOperationsService.forceRefreshAll(admin);
    revalidateCharacter();
    return { ok: true, result };
  } catch (error) {
    return mapActionError(error);
  }
}
