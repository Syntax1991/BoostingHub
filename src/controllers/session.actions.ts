"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { sessionManagementService } from "@/services/session-management.service";

export type SessionActionResult = { ok: true } | { ok: false; message: string };

function toResult(error: unknown): SessionActionResult {
  if (isDomainError(error)) {
    return { ok: false, message: error.message };
  }
  return { ok: false, message: "Session action failed." };
}

export async function revokeSessionAction(sessionId: string): Promise<SessionActionResult> {
  try {
    await sessionManagementService.revokeOwnSession(sessionId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function revokeOtherSessionsAction(): Promise<SessionActionResult> {
  try {
    await sessionManagementService.revokeOtherOwnSessions();
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Revokes every session including the current one, then sends the user to login. */
export async function revokeAllSessionsAction(): Promise<SessionActionResult> {
  try {
    await sessionManagementService.revokeAllOwnSessions();
  } catch (error) {
    return toResult(error);
  }
  redirect("/");
}
