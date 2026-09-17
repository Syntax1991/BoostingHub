import { z } from "zod";
import { RAID_DIFFICULTIES } from "@/models/enums";

export const setCharacterCurrentResetAvailabilitySchema = z
  .object({
    characterId: z.string().uuid(),
    available: z.boolean(),
    unavailableDifficulties: z.array(z.enum(RAID_DIFFICULTIES)).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.available) {
      const difficulties = value.unavailableDifficulties ?? [];
      if (difficulties.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select at least one difficulty when marking unavailable.",
          path: ["unavailableDifficulties"],
        });
      }
    }
  });
