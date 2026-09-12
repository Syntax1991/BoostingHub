import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import {
  compositionSchema,
  notesSchema,
  plannedBossCountSchema,
  scheduledStartAtSchema,
} from "@/validators/run";

/** Hard batch bounds — enforced here (structural) and again in the Service (authoritative). */
export const MASS_CREATE_MIN_RUNS = 1;
export const MASS_CREATE_MAX_RUNS = 25;

const massCreateDefaultsSchema = z.object({
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  plannedBossCount: plannedBossCountSchema,
});

// Every field is optional — an absent key means "inherit the shared default".
// `notes` is the one field where absent (inherit) and explicit `null`
// (clear the inherited notes for this row) are both meaningful and distinct
// from a provided string (override) — see run.service.ts's row merge.
const massCreateRowOverridesSchema = z.object({
  raidId: entityIdSchema.optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  lootType: z.enum(RUN_LOOT_TYPES).optional(),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema.optional(),
  desiredHealerCount: compositionSchema.optional(),
  desiredDpsCount: compositionSchema.optional(),
  plannedBossCount: plannedBossCountSchema.optional(),
});

const massCreateRowSchema = z.object({
  scheduledStartAt: scheduledStartAtSchema,
  overrides: massCreateRowOverridesSchema.optional(),
});

// Title is never accepted from the client here either — every row's title is
// always server-derived by buildRunTitle from the merged effective fields.
export const createManyRunsSchema = z.object({
  defaults: massCreateDefaultsSchema,
  runs: z
    .array(massCreateRowSchema)
    .min(MASS_CREATE_MIN_RUNS, "Add at least one run.")
    .max(MASS_CREATE_MAX_RUNS, `You can create at most ${MASS_CREATE_MAX_RUNS} runs at once.`),
});

export type CreateManyRunsInput = z.infer<typeof createManyRunsSchema>;
export type MassCreateDefaults = CreateManyRunsInput["defaults"];
export type MassCreateRunRow = CreateManyRunsInput["runs"][number];
export type MassCreateRowOverrides = NonNullable<MassCreateRunRow["overrides"]>;
