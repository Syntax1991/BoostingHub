import { z } from "zod";
import { WOW_REGIONS } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const battleNetRegionSchema = z.object({
  region: z.enum(WOW_REGIONS),
});

export const importSessionIdSchema = z.object({
  importSessionId: entityIdSchema,
});

export const enrichImportCandidateSchema = z.object({
  importSessionId: entityIdSchema,
  blizzardCharacterId: z.string().trim().min(1).max(32),
});

export const importBattleNetCharactersSchema = z.object({
  importSessionId: entityIdSchema,
  selections: z
    .array(
      z.object({
        blizzardCharacterId: z.string().trim().min(1).max(32),
        specialization: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .min(1, "Select at least one character."),
});

export const linkBattleNetCharacterSchema = z.object({
  importSessionId: entityIdSchema,
  blizzardCharacterId: z.string().trim().min(1).max(32),
  characterId: entityIdSchema,
});

export const refreshBlizzardCharacterSchema = z.object({
  characterId: entityIdSchema,
});
