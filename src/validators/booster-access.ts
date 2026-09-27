import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";

export const BOOSTER_ACCESS_REVIEW_REASON_MAX = 280;

/** Self-service requests are disabled; the character is only used for the ownership check. */
export const requestBoosterAccessSchema = z.object({
  characterId: entityIdSchema,
});

const reviewReasonSchema = z
  .string()
  .trim()
  .max(BOOSTER_ACCESS_REVIEW_REASON_MAX, "Review reason is too long.")
  .optional()
  .transform((value) => (value ? value : undefined));

export const boosterAccessIdSchema = z.object({
  accessId: entityIdSchema,
});

export const rejectBoosterAccessSchema = z.object({
  accessId: entityIdSchema,
  reason: reviewReasonSchema,
});

export const revokeBoosterAccessSchema = z.object({
  qualificationId: entityIdSchema,
  reason: reviewReasonSchema,
});

export const grantBoosterAccessSchema = z.object({
  userId: entityIdSchema,
  notes: reviewReasonSchema,
});
