"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";

const setCurrentResetAvailabilitySchema = z.object({
  characterId: z.string().uuid(),
  available: z.boolean(),
});

function revalidateCharacterAvailability(characterId: string) {
  revalidatePath("/characters");
  revalidatePath(`/characters/${characterId}`);
  revalidatePath("/dashboard");
  revalidatePath("/my-runs");
  revalidatePath("/runs");
}

export async function setCharacterCurrentResetAvailabilityAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = setCurrentResetAvailabilitySchema.parse(input);
    await characterWeeklyAvailabilityService.setCurrentResetAvailability(user, parsed);
    revalidateCharacterAvailability(parsed.characterId);
    return { ok: true, message: parsed.available ? "Marked available." : "Marked unavailable." };
  } catch (error) {
    return mapActionError(error);
  }
}
