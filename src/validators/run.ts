import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { RUN_COMPOSITION_MAX, RUN_COMPOSITION_MIN, RUN_NOTES_MAX } from "@/services/run-state";

const compositionSchema = z.coerce
  .number()
  .int("Composition counts must be whole numbers.")
  .min(RUN_COMPOSITION_MIN, "Composition counts cannot be negative.")
  .max(RUN_COMPOSITION_MAX, "Composition count is too high.");

const scheduledStartAtSchema = z
  .string()
  .trim()
  .min(1, "Choose a scheduled start.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid scheduled start.");

const notesSchema = z
  .string()
  .trim()
  .max(RUN_NOTES_MAX, "Notes are too long.")
  .optional()
  .nullable();

/** Upper bound against the raid's actual total boss count is validated in the Service layer. */
const plannedBossCountSchema = z.coerce.number().int("Boss count must be a whole number.").min(1, "Boss count must be at least 1.");

// Title is never accepted from the client — the server always derives it via
// buildRunTitle from the other structured fields below.
export const createRunSchema = z.object({
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  plannedBossCount: plannedBossCountSchema,
});

export const updateRunSchema = z.object({
  runId: entityIdSchema,
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  plannedBossCount: plannedBossCountSchema,
});

export const runIdSchema = z.object({
  runId: entityIdSchema,
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
