import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { RUN_COMPOSITION_MAX, RUN_COMPOSITION_MIN, RUN_NOTES_MAX } from "@/services/run-state";

// Exported so create-many (and any other Run-adjacent validator) can reuse
// the exact same field rules instead of drifting into a second definition.
export const compositionSchema = z.coerce
  .number()
  .int("Composition counts must be whole numbers.")
  .min(RUN_COMPOSITION_MIN, "Composition counts cannot be negative.")
  .max(RUN_COMPOSITION_MAX, "Composition count is too high.");

export const scheduledStartAtSchema = z
  .string()
  .trim()
  .min(1, "Choose a scheduled start.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid scheduled start.");

export const notesSchema = z
  .string()
  .trim()
  .max(RUN_NOTES_MAX, "Notes are too long.")
  .optional()
  .nullable();

/** Upper bound against the raid's actual total boss count is validated in the Service layer. */
export const plannedBossCountSchema = z.coerce
  .number()
  .int("Boss count must be a whole number.")
  .min(1, "Boss count must be at least 1.");

/**
 * Planned boss count per VARIABLE ProductRaidContent id. Bounds (product
 * minimum, raid encounter count) are enforced by the server against the DB
 * catalog; FIXED contents are server-forced and never read from here.
 */
export const contentBossCountsSchema = z.record(z.string().min(1).max(64), plannedBossCountSchema);

/**
 * Product-driven content selection: any persisted active + selectable Product
 * by id (no key enum). Ordered contents are resolved server-side.
 */
export const productSelectionShape = {
  productId: entityIdSchema,
  contentBossCounts: contentBossCountsSchema.optional(),
};

const createRunCommonSchema = z.object({
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  /** Planned Lootbuddy slots (a target, never a signup). Omitted by older callers → 0 (service default). */
  desiredLootbuddyCount: compositionSchema.optional(),
  /** Ping Tank/Healer/DPS Discord roles when the Run channel is first created. Default true. */
  discordRolePing: z.boolean().optional(),
});

/**
 * Create shape: a Product selection (`productId` + per-content counts).
 * Legacy single-raid `raidId` + `plannedBossCount` remains accepted for
 * fixtures / transitional callers (PR4 legacy).
 */
export const createRunSchema = z.union([
  createRunCommonSchema.extend(productSelectionShape),
  createRunCommonSchema.extend({
    raidId: entityIdSchema,
    plannedBossCount: plannedBossCountSchema,
  }),
]);

/**
 * Edit Run. Content is one of: a product re-selection (`productId` +
 * counts), the legacy single-raid shape (`raidId` + `plannedBossCount`),
 * or neither — the Run keeps its current contents unchanged.
 */
export const updateRunSchema = z
  .object({
    runId: entityIdSchema,
    difficulty: z.enum(RAID_DIFFICULTIES),
    lootType: z.enum(RUN_LOOT_TYPES),
    scheduledStartAt: scheduledStartAtSchema,
    raidLeadId: entityIdSchema.optional(),
    notes: notesSchema,
    desiredTankCount: compositionSchema,
    desiredHealerCount: compositionSchema,
    desiredDpsCount: compositionSchema,
    /** Omitted → the Run keeps its current Lootbuddy target. */
    desiredLootbuddyCount: compositionSchema.optional(),
    discordRolePing: z.boolean().optional(),
    productId: productSelectionShape.productId.optional(),
    contentBossCounts: productSelectionShape.contentBossCounts,
    raidId: entityIdSchema.optional(),
    plannedBossCount: plannedBossCountSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.productId && value.raidId) {
      ctx.addIssue({ code: "custom", message: "Choose either a product or a single raid, not both.", path: ["productId"] });
    }
    if (value.contentBossCounts && !value.productId) {
      ctx.addIssue({ code: "custom", message: "Boss counts require a product.", path: ["contentBossCounts"] });
    }
    if ((value.raidId === undefined) !== (value.plannedBossCount === undefined)) {
      ctx.addIssue({ code: "custom", message: "A single raid needs both a raid and a boss count.", path: ["raidId"] });
    }
  });

export const runIdSchema = z.object({
  runId: entityIdSchema,
});

export const startRunSchema = z.object({
  runId: entityIdSchema,
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
