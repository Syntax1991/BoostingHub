import { z } from "zod";

/**
 * Content Catalog (/manage/content) input validation.
 * Blizzard and Warcraft Logs identities are validated separately and never merged.
 */

const MAX_ID = 2_147_483_647; // Postgres int4

const positiveId = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .positive(`${label} must be a positive number.`)
    .max(MAX_ID, `${label} is too large.`);

/** Optional integration id: empty input → null. */
const optionalId = (label: string) =>
  z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return null;
    if (typeof value === "string") return Number(value.trim());
    return value;
  }, positiveId(label).nullable());

/**
 * Encounter id list from a structured input ("2849, 3379" or one per line, or a number array).
 * Positive integers, no duplicates; normalized to ascending order. Empty is allowed.
 */
export function encounterIdList(label: string) {
  return z.preprocess(
    (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value !== "string") return value;
      const parts = value.split(/[\s,;]+/).filter((part) => part.length > 0);
      return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
    },
    z
      .array(positiveId(`${label} ids`), { error: `${label} ids must be a list of numbers.` })
      .max(50, `Too many ${label} ids.`)
      .refine((ids) => new Set(ids).size === ids.length, `${label} ids must not contain duplicates.`)
      .transform((ids) => [...ids].sort((a, b) => a - b)),
  );
}

const name = z.string().trim().min(1, "Name is required.").max(100, "Name is too long.");
const season = z.string().trim().min(1, "Season is required.").max(100, "Season is too long.");
const sortOrder = z.coerce
  .number({ error: "Order must be a number." })
  .int("Order must be a whole number.")
  .min(0, "Order cannot be negative.")
  .max(10_000, "Order is too large.");

export const raidMetadataSchema = z.object({
  name,
  season,
  sortOrder,
  trackLockouts: z.boolean(),
  blizzardInstanceId: optionalId("Blizzard instance id"),
  wclZoneId: optionalId("Warcraft Logs zone id"),
  wclRankingEncounterId: optionalId("Warcraft Logs ranking encounter id"),
});
export type RaidMetadataInput = z.infer<typeof raidMetadataSchema>;

export const createRaidSchema = raidMetadataSchema;

export const updateRaidSchema = raidMetadataSchema.extend({
  raidId: z.string().min(1),
  /** Legacy `Raid.isActive`: selectable when creating / editing a Run (else "Historical"). */
  availableForRuns: z.boolean(),
});
export type UpdateRaidInput = z.infer<typeof updateRaidSchema>;

export const raidIdSchema = z.object({ raidId: z.string().min(1) });

export const encounterFieldsSchema = z.object({
  name,
  blizzardEncounterIds: encounterIdList("Blizzard encounter"),
  wclEncounterIds: encounterIdList("Warcraft Logs encounter"),
});
export type EncounterFieldsInput = z.infer<typeof encounterFieldsSchema>;

export const createEncounterSchema = encounterFieldsSchema.extend({ raidId: z.string().min(1) });
export const updateEncounterSchema = encounterFieldsSchema.extend({ bossId: z.string().min(1) });
export const encounterIdSchema = z.object({ bossId: z.string().min(1) });
export const moveEncounterSchema = z.object({
  bossId: z.string().min(1),
  direction: z.enum(["UP", "DOWN"]),
});

const optionalCount = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  if (typeof value === "string") return Number(value.trim());
  return value;
}, z.number({ error: "Boss counts must be numbers." }).int("Boss counts must be whole numbers.").nullable());

export const productContentSchema = z.object({
  raidId: z.string().min(1, "Choose a raid for every content row."),
  bossCountMode: z.enum(["FIXED", "VARIABLE"]),
  fixedBossCount: optionalCount,
  minBossCount: optionalCount,
  defaultBossCount: optionalCount,
});
export type ProductContentInput = z.infer<typeof productContentSchema>;

const productFields = {
  name,
  active: z.boolean(),
  selectable: z.boolean(),
  sortOrder,
  /** Ordered: the array position is the content sortOrder (1-based). */
  contents: z.array(productContentSchema).min(1, "A product needs at least one raid content.").max(10),
};

export const PRODUCT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export const createProductSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(PRODUCT_KEY_PATTERN, "Key must be UPPER_SNAKE_CASE (letters, digits, underscores)."),
  ...productFields,
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** The product key is stable identity: never part of an update. */
export const updateProductSchema = z.object({ productId: z.string().min(1), ...productFields });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productIdSchema = z.object({ productId: z.string().min(1) });
