import { z } from "zod";
import {
  CHARACTER_ROLES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  PARTICIPATION_TYPES,
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

const characterOfferSchema = z.object({
  characterId: entityIdSchema,
  role: z.enum(CHARACTER_ROLES).optional(),
});

/** The complete desired Character-offer set for one Run + participation type — not additive. */
export const setCharacterOffersSchema = z.object({
  runId: entityIdSchema,
  participationType: z.enum(PARTICIPATION_TYPES),
  offers: z.array(characterOfferSchema).max(50),
  lootbuddyMode: z.enum(LOOTBUDDY_MODES).optional(),
  lootbuddyVerification: z.enum(LOOTBUDDY_VERIFICATIONS).optional(),
});

export const cancelSignupSchema = z.object({
  runId: entityIdSchema,
});
