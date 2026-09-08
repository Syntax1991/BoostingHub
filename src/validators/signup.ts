import { z } from "zod";
import {
  CHARACTER_ROLES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
} from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const boosterSignupSchema = z.object({
  runId: entityIdSchema,
  characterId: entityIdSchema,
  role: z.enum(CHARACTER_ROLES),
  isBackup: z.boolean(),
});

export const lootbuddySignupSchema = z.object({
  runId: entityIdSchema,
  characterId: entityIdSchema,
  mode: z.enum(LOOTBUDDY_MODES),
  verification: z.enum(LOOTBUDDY_VERIFICATIONS),
});

export const withdrawSignupSchema = z.object({
  signupId: entityIdSchema,
});

export const signupOptionsSchema = z.object({
  runId: entityIdSchema,
});
