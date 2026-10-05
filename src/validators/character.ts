import { z } from "zod";
import { WOW_REGIONS } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import {
  CHARACTER_NAME_MAX,
  CHARACTER_NAME_MIN,
  CHARACTER_REALM_MAX,
  CHARACTER_REALM_MIN,
} from "@/lib/character-identity";
import { RAIDER_IO_BULK_MAX } from "@/lib/map-with-concurrency";

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

const playableSpecsSchema = z
  .array(z.string().trim().min(1))
  .max(10)
  .default([])
  .transform((specs) => [...new Set(specs.map((spec) => spec.trim()).filter(Boolean))]);

/** Raider.IO Character profile URL for a single Add Character row. */
export const lookupCharacterFromRaiderIoSchema = z.object({
  url: z.string().trim().min(1, "Enter a Raider.IO character profile link.").max(500),
});

/** Bulk Raider.IO URL preview — server enforces 1–10 independently of the client. */
export const lookupCharactersFromRaiderIoSchema = z.object({
  urls: z
    .array(z.string().trim().min(1).max(500))
    .min(1, "Enter at least one Raider.IO character profile link.")
    .max(RAIDER_IO_BULK_MAX, `You can look up at most ${RAIDER_IO_BULK_MAX} characters at once.`),
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
  playableSpecs: playableSpecsSchema,
});

/** Bulk Add Character — each item re-resolves Blizzard; clientId maps results to rows. */
export const createCharactersSchema = z.object({
  characters: z
    .array(
      createCharacterSchema.extend({
        clientId: z.string().trim().min(1).max(64),
      }),
    )
    .min(1, "Select at least one character to add.")
    .max(RAIDER_IO_BULK_MAX, `You can add at most ${RAIDER_IO_BULK_MAX} characters at once.`),
});

/** Item level is never editable — it stays Blizzard-authoritative. */
export const updateCharacterSchema = z.object({
  characterId: entityIdSchema,
  name: nameSchema,
  realm: realmSchema,
  region: z.enum(WOW_REGIONS),
  specialization: z.string().trim().min(1, "Choose a specialization."),
  playableSpecs: playableSpecsSchema,
});
