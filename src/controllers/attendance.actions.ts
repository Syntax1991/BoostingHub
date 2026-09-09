"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { attendanceService } from "@/services/attendance.service";
import { markAllPresentSchema, setAttendanceSchema } from "@/validators/attendance";

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
