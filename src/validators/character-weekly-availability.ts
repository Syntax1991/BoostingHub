import { z } from "zod";

export const setCharacterCurrentResetAvailabilitySchema = z.object({
  characterId: z.string().uuid(),
  available: z.boolean(),
});
