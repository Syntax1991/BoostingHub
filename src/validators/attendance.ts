import { z } from "zod";
import { ATTENDANCE_STATUSES, CHARACTER_ROLES, MARKABLE_ATTENDANCE_STATUSES, WOW_CLASSES } from "@/models/enums";
import { ATTENDANCE_NOTE_MAX } from "@/services/run-state";
import { entityIdSchema } from "@/validators/ids";

export { startRunSchema } from "@/validators/run";

export const completeRunSchema = z.object({
  runId: entityIdSchema,
});

export const markAllPresentSchema = z.object({
  runId: entityIdSchema,
});

/** Replace a participant after Start — with another signup of the Run or an external booster. */
export const replaceParticipantSchema = z.object({
  attendanceId: entityIdSchema,
  replacement: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("signup"), signupId: entityIdSchema }),
    z.object({
      kind: z.literal("external"),
      name: z.string().max(64),
      wowClass: z.enum(WOW_CLASSES),
      /** Ignored for a lootbuddy slot. */
      role: z.enum(CHARACTER_ROLES).nullable(),
    }),
  ]),
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

export const ATTENDANCE_CORRECTION_REASON_MIN = 5;
export const ATTENDANCE_CORRECTION_REASON_MAX = 300;

/**
 * Post-completion attendance correction (COMPLETED Runs only). Status-only:
 * the row is identified by attendanceId; expectedCurrentStatus is the
 * stale-write guard. UNMARKED is never a valid correction target — a
 * completed Run has every participant marked.
 */
export const correctAttendanceSchema = z.object({
  runId: entityIdSchema,
  attendanceId: entityIdSchema,
  expectedCurrentStatus: z.enum(ATTENDANCE_STATUSES),
  newStatus: z.enum(MARKABLE_ATTENDANCE_STATUSES as unknown as [string, ...string[]]),
  reason: z
    .string()
    .trim()
    .min(ATTENDANCE_CORRECTION_REASON_MIN, `Give a reason of at least ${ATTENDANCE_CORRECTION_REASON_MIN} characters.`)
    .max(ATTENDANCE_CORRECTION_REASON_MAX, `The reason must be ${ATTENDANCE_CORRECTION_REASON_MAX} characters or fewer.`),
});
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
