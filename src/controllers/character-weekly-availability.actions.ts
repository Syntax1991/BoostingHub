"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { setCharacterCurrentResetAvailabilitySchema } from "@/validators/character-weekly-availability";

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
    const parsed = setCharacterCurrentResetAvailabilitySchema.parse(input);
    await characterWeeklyAvailabilityService.setCurrentResetAvailability(user, {
      characterId: parsed.characterId,
      available: parsed.available,
      unavailableDifficulties: parsed.available
        ? undefined
        : (parsed.unavailableDifficulties ?? []),
    });
    revalidateCharacterAvailability(parsed.characterId);
    return {
      ok: true,
      message: parsed.available ? "Marked available." : "Marked unavailable.",
    };
  } catch (error) {
    return mapActionError(error);
  }
}
