import { z } from "zod";
import { PRODUCT_KEY_PATTERN } from "@/lib/product-key";

/**
 * Raid Catalog (/manage/raid-catalog) input validation.
 * Blizzard and Warcraft Logs identities are validated separately and never merged.
 */

export { PRODUCT_KEY_PATTERN };

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

/** Primary raid fields admins edit. WCL ids are discovered server-side, never typed here. */
export const raidMetadataSchema = z.object({
  name,
  season,
  sortOrder,
  trackLockouts: z.boolean(),
  /** Optional advanced Blizzard journal instance id; normally detected from the Blizzard journal. */
  blizzardInstanceId: optionalId("Blizzard instance id"),
});
export type RaidMetadataInput = z.infer<typeof raidMetadataSchema>;

export const createRaidSchema = raidMetadataSchema;

export const updateRaidSchema = raidMetadataSchema.extend({
  raidId: z.string().min(1),
  /** Compact label ("Venom"); blank clears it (derived from the name). Optional for older clients. */
  shortName: z
    .string()
    .trim()
    .max(24, "Short name is at most 24 characters.")
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
  /** Legacy `Raid.isActive`: selectable when creating / editing a Run (else "Historical"). */
  availableForRuns: z.boolean(),
});
/** `shortName` omitted keeps the stored value (older clients, scripts, tests). */
export type UpdateRaidInput = Omit<z.infer<typeof updateRaidSchema>, "shortName"> & {
  shortName?: string | null;
};

export const raidIdSchema = z.object({ raidId: z.string().min(1) });

/** Blizzard journal instance id typed by the admin ("1320"). */
const journalInstanceId = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim()) : value),
  positiveId("Blizzard Journal Instance ID"),
);

export const previewRaidImportSchema = z.object({ journalInstanceId });

/** Season / lockout tracking apply only when the import creates the raid. */
export const importRaidSchema = z.object({
  journalInstanceId,
  season: season.optional(),
  trackLockouts: z.boolean().optional(),
});

export const seasonKeySchema = z.object({
  seasonKey: z.string().trim().min(1, "Choose a season.").max(64),
});

export const importSeasonSchema = seasonKeySchema.extend({ trackLockouts: z.boolean().optional() });

/** Internal / discovery-facing encounter fields (includes WCL ids). */
export const encounterFieldsSchema = z.object({
  name,
  blizzardEncounterIds: encounterIdList("Blizzard encounter"),
  wclEncounterIds: encounterIdList("Warcraft Logs encounter"),
});
export type EncounterFieldsInput = z.infer<typeof encounterFieldsSchema>;

/** Admin create/edit: Blizzard ids optional; WCL ids are discovered server-side. */
export const encounterAdminFieldsSchema = z.object({
  name,
  blizzardEncounterIds: encounterIdList("Blizzard encounter"),
});
export type EncounterAdminFieldsInput = z.infer<typeof encounterAdminFieldsSchema>;

export const createEncounterSchema = encounterAdminFieldsSchema.extend({ raidId: z.string().min(1) });
export const updateEncounterSchema = encounterAdminFieldsSchema.extend({ bossId: z.string().min(1) });
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

/** Create never accepts a client-supplied key — the server generates it from `name`. */
export const createProductSchema = z.object({ ...productFields });
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** The product key is stable identity: never part of an update. */
export const updateProductSchema = z.object({ productId: z.string().min(1), ...productFields });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productIdSchema = z.object({ productId: z.string().min(1) });
