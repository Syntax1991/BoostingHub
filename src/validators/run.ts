import { z } from "zod";
import { RAID_DIFFICULTIES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { RUN_COMPOSITION_MAX, RUN_COMPOSITION_MIN, RUN_NOTES_MAX, RUN_TITLE_MAX } from "@/services/run-state";

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

const titleSchema = z
  .string()
  .trim()
  .max(RUN_TITLE_MAX, "Title is too long.")
  .optional();

const notesSchema = z
  .string()
  .trim()
  .max(RUN_NOTES_MAX, "Notes are too long.")
  .optional()
  .nullable();

export const createRunSchema = z.object({
  title: titleSchema,
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
});

export const updateRunSchema = z.object({
  runId: entityIdSchema,
  title: z.string().trim().min(1, "Enter a title.").max(RUN_TITLE_MAX, "Title is too long."),
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  scheduledStartAt: scheduledStartAtSchema,
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
});

export const runIdSchema = z.object({
  runId: entityIdSchema,
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
