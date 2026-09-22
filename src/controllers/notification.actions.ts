"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { notificationService } from "@/services/notification.service";
import { markNotificationReadSchema } from "@/validators/notification";

function revalidateNotificationSurfaces() {
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function markNotificationReadAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = markNotificationReadSchema.parse(input);
    await notificationService.markRead(user, parsed.notificationId);
    revalidateNotificationSurfaces();
    return { ok: true, message: "Notification marked read." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await notificationService.markAllRead(user);
    revalidateNotificationSurfaces();
    return { ok: true, message: "All notifications marked read." };
  } catch (error) {
    return mapActionError(error);
  }
}
