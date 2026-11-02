import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";

export const BOOSTER_ACCESS_REVIEW_REASON_MAX = 280;

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
