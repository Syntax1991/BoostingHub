"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { attendanceService } from "@/services/attendance.service";
import {
  correctAttendanceSchema,
  markAllPresentSchema,
  replaceParticipantSchema,
  setAttendanceSchema,
} from "@/validators/attendance";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/labels";

function revalidateAttendance(runId: string) {
  revalidatePath("/runs");
  revalidatePath("/my-runs");
  revalidatePath("/manage/runs");
  revalidatePath("/dashboard");
  revalidatePath(`/runs/${runId}`);
}

export async function setAttendanceAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = setAttendanceSchema.parse(input);
    const updated = await attendanceService.setStatus(user, parsed);
    revalidateAttendance(updated.runId);
    return { ok: true, message: "Attendance updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function replaceParticipantAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = replaceParticipantSchema.parse(input);
    const result = await attendanceService.replaceParticipant(user, parsed);
    revalidateAttendance(result.runId);
    return { ok: true, message: `Replaced with ${result.replacementName}. The Final Setup post will update.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function markAllPresentAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = markAllPresentSchema.parse(input);
    const count = await attendanceService.markAllUnmarkedPresent(user, parsed.runId);
    revalidateAttendance(parsed.runId);
    return {
      ok: true,
      message:
        count === 0
          ? "No unmarked attendance remained."
          : `Marked ${count} unmarked ${count === 1 ? "participant" : "participants"} present.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

/** Exceptional audited correction on a COMPLETED Run (Raid Lead / ADMIN / OWNER). */
export async function correctAttendanceAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = correctAttendanceSchema.parse(input);
    const result = await attendanceService.correctCompletedAttendance(user, parsed);
    revalidateAttendance(result.runId);
    return {
      ok: true,
      message: `Attendance corrected: ${result.participantName} ${ATTENDANCE_STATUS_LABELS[result.fromStatus]} → ${ATTENDANCE_STATUS_LABELS[result.toStatus]}.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}
