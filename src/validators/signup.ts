import { z } from "zod";
import {
  CHARACTER_ROLES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  WOW_CLASSES,
} from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const boosterSignupSchema = z.object({
  runId: entityIdSchema,
  characterId: entityIdSchema,
  role: z.enum(CHARACTER_ROLES),
  isBackup: z.boolean(),
});

export const withdrawSignupSchema = z.object({
  signupId: entityIdSchema,
});

export const signupOptionsSchema = z.object({
  runId: entityIdSchema,
});

/** A BOOSTER offer volunteers one or more roles; the server re-checks them against the Character's class. */
const characterOfferSchema = z.object({
  characterId: entityIdSchema,
  offeredRoles: z.array(z.enum(CHARACTER_ROLES)).min(1).max(CHARACTER_ROLES.length),
});

/** The complete desired BOOSTER Character-offer set for one Run — not additive, never touches Lootbuddy entries. */
export const setCharacterOffersSchema = z.object({
  runId: entityIdSchema,
  offers: z.array(characterOfferSchema).max(50),
});

/** One characterless Lootbuddy entry. `signupId` present edits that existing owned row; absent always creates a new one. */
const lootbuddyEntrySchema = z.object({
  signupId: entityIdSchema.optional(),
  wowClass: z.enum(WOW_CLASSES),
  mode: z.enum(LOOTBUDDY_MODES),
  verification: z.enum(LOOTBUDDY_VERIFICATIONS).optional(),
});

/** The complete desired LOOTBUDDY entry set for one Run — a distinct collection from Booster offers, not additive, never touches Booster rows. */
export const setLootbuddiesSchema = z.object({
  runId: entityIdSchema,
  lootbuddies: z.array(lootbuddyEntrySchema).max(20),
});

export const cancelSignupSchema = z.object({
  runId: entityIdSchema,
});
