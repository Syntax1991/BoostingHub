import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { RUN_COMPOSITION_MAX, RUN_COMPOSITION_MIN, RUN_NOTES_MAX } from "@/services/run-state";
import { RUN_CONTENT_PRESET_KEYS } from "@/lib/run-content-presets";

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

/** Commercial Venomous slot on Create/Edit products (1–8). */
export const venomousPlannedBossCountSchema = z.coerce
  .number()
  .int("Boss count must be a whole number.")
  .min(1, "Venomous boss count must be at least 1.")
  .max(8, "Venomous boss count cannot exceed 8.");

export const runContentPresetSchema = z.enum(RUN_CONTENT_PRESET_KEYS);

const createRunCommonSchema = z.object({
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
});

/**
 * Preferred commercial Create shape (Product presets).
 * Legacy `raidId` + `plannedBossCount` remains accepted for fixtures / transitional callers.
 */
export const createRunSchema = z.union([
  createRunCommonSchema.extend({
    contentPreset: runContentPresetSchema,
    venomousPlannedBossCount: venomousPlannedBossCountSchema,
  }),
  createRunCommonSchema.extend({
    raidId: entityIdSchema,
    plannedBossCount: plannedBossCountSchema,
  }),
]);

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
  })
  .and(
    z.union([
      z.object({
        contentPreset: runContentPresetSchema,
        venomousPlannedBossCount: venomousPlannedBossCountSchema,
      }),
      z.object({
        raidId: entityIdSchema,
        plannedBossCount: plannedBossCountSchema,
      }),
    ]),
  );

export const runIdSchema = z.object({
  runId: entityIdSchema,
});

export const startRunSchema = z.object({
  runId: entityIdSchema,
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
