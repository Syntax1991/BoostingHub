"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { settingsService } from "@/services/settings.service";
import {
  updateDmPreferencesSchema,
  updateGameplayPreferencesSchema,
  updateRegionalPreferencesSchema,
  updateRunChannelPreferencesSchema,
} from "@/validators/notification";

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

export async function updateRegionalSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRegionalPreferencesSchema.parse(input);
    await settingsService.updateRegionalPreferences(user, parsed);
    revalidatePath("/settings");
    revalidatePath("/notifications");
    revalidatePath("/dashboard");
    revalidatePath("/my-runs");
    return { ok: true, message: "Regional preferences saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateGameplaySettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateGameplayPreferencesSchema.parse(input);
    await settingsService.updateGameplayPreferences(user, parsed);
    revalidatePath("/settings");
    return { ok: true, message: "Gameplay preferences saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRunChannelSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunChannelPreferencesSchema.parse(input);
    await settingsService.updateRunChannelPreferences(user, parsed);
    revalidatePath("/settings");
    return { ok: true, message: "Run channel preferences saved." };
  } catch (error) {
    return mapActionError(error);
  }
}
