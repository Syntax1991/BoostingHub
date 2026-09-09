import { z } from "zod";
import { WOW_CLASSES, WOW_REGIONS } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import {
  CHARACTER_ITEM_LEVEL_MAX,
  CHARACTER_ITEM_LEVEL_MIN,
  CHARACTER_NAME_MAX,
  CHARACTER_NAME_MIN,
  CHARACTER_REALM_MAX,
  CHARACTER_REALM_MIN,
} from "@/lib/character-identity";

export const characterIdSchema = z.object({
  characterId: entityIdSchema,
});

const nameSchema = z
  .string()
  .trim()
  .min(CHARACTER_NAME_MIN, "Enter a character name.")
  .max(CHARACTER_NAME_MAX, "Character name is too long.");

const realmSchema = z
  .string()
  .trim()
  .min(CHARACTER_REALM_MIN, "Enter a realm.")
  .max(CHARACTER_REALM_MAX, "Realm name is too long.");

const itemLevelSchema = z.coerce
  .number()
  .int("Item level must be a whole number.")
  .min(CHARACTER_ITEM_LEVEL_MIN, "Item level cannot be negative.")
  .max(CHARACTER_ITEM_LEVEL_MAX, "Item level is too high.");

export const createCharacterSchema = z.object({
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
  wowClass: z.enum(WOW_CLASSES),
  specialization: z.string().trim().min(1, "Choose a specialization."),
  itemLevel: itemLevelSchema,
});

export const updateCharacterSchema = z.object({
  characterId: entityIdSchema,
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
  specialization: z.string().trim().min(1, "Choose a specialization."),
  itemLevel: itemLevelSchema,
});
