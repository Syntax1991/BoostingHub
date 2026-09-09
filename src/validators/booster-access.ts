import { z } from "zod";
import { CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const BOOSTER_ACCESS_REVIEW_REASON_MAX = 280;

export const requestBoosterAccessSchema = z.object({
  characterId: entityIdSchema,
  role: z.enum(CHARACTER_ROLES),
  difficulty: z.enum(RAID_DIFFICULTIES),
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
  accessId: entityIdSchema,
  reason: reviewReasonSchema,
});
