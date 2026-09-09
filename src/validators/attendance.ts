import { z } from "zod";
import { ATTENDANCE_STATUSES } from "@/models/enums";
import { ATTENDANCE_NOTE_MAX } from "@/services/run-state";
import { entityIdSchema } from "@/validators/ids";

export const startRunSchema = z.object({
  runId: entityIdSchema,
});

export const completeRunSchema = z.object({
  runId: entityIdSchema,
});

export const markAllPresentSchema = z.object({
  runId: entityIdSchema,
});

export const setAttendanceSchema = z.object({
  attendanceId: entityIdSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  note: z
    .string()
    .trim()
    .max(ATTENDANCE_NOTE_MAX, `Attendance notes must be ${ATTENDANCE_NOTE_MAX} characters or fewer.`)
    .optional()
    .nullable(),
});
