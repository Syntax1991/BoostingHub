import { z } from "zod";
import { WOW_REGIONS } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import {
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

/** Region/Realm/Name only — wowClass and itemLevel are never client-supplied. */
export const lookupCharacterSchema = z.object({
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
});

/**
 * wowClass and itemLevel are intentionally absent: the server always
 * re-resolves them from Blizzard's public Character Profile before
 * persisting, so a forged or stale client value can never be stored.
 */
export const createCharacterSchema = z.object({
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
  specialization: z.string().trim().min(1, "Choose a specialization."),
});

/** Item level is never editable — it stays Blizzard-authoritative. */
export const updateCharacterSchema = z.object({
  characterId: entityIdSchema,
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
  specialization: z.string().trim().min(1, "Choose a specialization."),
});
