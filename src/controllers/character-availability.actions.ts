"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { characterAvailabilityService } from "@/services/character-availability.service";
import {
  availabilityBlockIdSchema,
  createAvailabilityBlockSchema,
  updateAvailabilityBlockSchema,
} from "@/validators/character-availability";

function revalidateAvailability(characterId: string) {
  revalidatePath(`/characters/${characterId}`);
  revalidatePath("/characters");
  revalidatePath("/runs");
}

export async function createAvailabilityBlockAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = createAvailabilityBlockSchema.parse(input);
    await characterAvailabilityService.createBlock(user, parsed.characterId, parsed);
    revalidateAvailability(parsed.characterId);
    return { ok: true, message: "Unavailable time added." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateAvailabilityBlockAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateAvailabilityBlockSchema.parse(input);
    const updated = await characterAvailabilityService.updateBlock(user, parsed.blockId, parsed);
    revalidateAvailability(updated.characterId);
    return { ok: true, message: "Unavailable time updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteAvailabilityBlockAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = availabilityBlockIdSchema.parse(input);
    const deleted = await characterAvailabilityService.deleteBlock(user, parsed.blockId);
    revalidateAvailability(deleted.characterId);
    return { ok: true, message: "Unavailable time removed." };
  } catch (error) {
    return mapActionError(error);
  }
}
