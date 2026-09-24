import { z } from "zod";
import { ATTENDANCE_STATUSES, CHARACTER_ROLES, WOW_CLASSES } from "@/models/enums";
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
