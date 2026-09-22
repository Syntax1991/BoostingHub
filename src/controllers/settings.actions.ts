"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { settingsService } from "@/services/settings.service";
import { updateDmPreferencesSchema } from "@/validators/notification";

export async function updateNotificationSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateDmPreferencesSchema.parse(input);
    await settingsService.updateNotificationDmPreferences(user, parsed);
    revalidatePath("/settings");
    return { ok: true, message: "Notification preferences saved." };
  } catch (error) {
    return mapActionError(error);
  }
}
