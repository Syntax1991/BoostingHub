import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";
import { STRIKE_NOTES_MAX, STRIKE_REASON_MAX, STRIKE_REVOKE_REASON_MAX } from "@/services/strike-state";

export const addStrikeSchema = z
  .object({
    userId: entityIdSchema.optional(),
    runId: entityIdSchema.optional(),
    attendanceId: entityIdSchema.optional(),
    reason: z
      .string()
      .trim()
      .min(1, "A strike reason is required.")
      .max(STRIKE_REASON_MAX, `Strike reasons must be ${STRIKE_REASON_MAX} characters or fewer.`),
    notes: z
      .string()
      .trim()
      .max(STRIKE_NOTES_MAX, `Strike notes must be ${STRIKE_NOTES_MAX} characters or fewer.`)
      .optional()
      .nullable(),
  })
  .refine((data) => Boolean(data.userId) || Boolean(data.attendanceId), {
    message: "Provide a target user or an attendance record.",
    path: ["userId"],
  });

export const revokeStrikeSchema = z.object({
  strikeId: entityIdSchema,
  revokedReason: z
    .string()
    .trim()
    .min(1, "A reason is required to revoke a strike.")
    .max(STRIKE_REVOKE_REASON_MAX, `Revoke reasons must be ${STRIKE_REVOKE_REASON_MAX} characters or fewer.`),
});

export const userStrikeHistorySchema = z.object({
  userId: entityIdSchema,
});

export const runStrikeHistorySchema = z.object({
  runId: entityIdSchema,
});
