import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";
import {
  DEDUCT_AMOUNT_MAX,
  DEDUCT_NOTES_MAX,
  DEDUCT_REASON_MAX,
  DEDUCT_REVOKE_REASON_MAX,
} from "@/services/deduct-state";

export const addDeductSchema = z.object({
  payoutEntryId: entityIdSchema,
  amountGold: z.number().int().positive().max(DEDUCT_AMOUNT_MAX),
  reason: z
    .string()
    .trim()
    .min(1, "A deduct reason is required.")
    .max(DEDUCT_REASON_MAX, `Deduct reasons must be ${DEDUCT_REASON_MAX} characters or fewer.`),
  notes: z
    .string()
    .trim()
    .max(DEDUCT_NOTES_MAX, `Deduct notes must be ${DEDUCT_NOTES_MAX} characters or fewer.`)
    .optional()
    .nullable(),
  strikeId: entityIdSchema.optional().nullable(),
});

export const revokeDeductSchema = z.object({
  deductId: entityIdSchema,
  revokedReason: z
    .string()
    .trim()
    .min(1, "A reason is required to revoke a deduct.")
    .max(DEDUCT_REVOKE_REASON_MAX, `Revoke reasons must be ${DEDUCT_REVOKE_REASON_MAX} characters or fewer.`),
});
