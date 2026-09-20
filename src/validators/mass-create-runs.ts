import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import {
  compositionSchema,
  notesSchema,
  plannedBossCountSchema,
  runContentPresetSchema,
  scheduledStartAtSchema,
  venomousPlannedBossCountSchema,
} from "@/validators/run";

/** Hard batch bounds — enforced here (structural) and again in the Service (authoritative). */
export const MASS_CREATE_MIN_RUNS = 1;
export const MASS_CREATE_MAX_RUNS = 25;

const massCreateDefaultsCommercialSchema = z.object({
  contentPreset: runContentPresetSchema,
  venomousPlannedBossCount: venomousPlannedBossCountSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  discordRolePing: z.boolean().optional(),
});

const massCreateDefaultsLegacySchema = z.object({
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  plannedBossCount: plannedBossCountSchema,
  discordRolePing: z.boolean().optional(),
});

const massCreateDefaultsSchema = z.union([
  massCreateDefaultsCommercialSchema,
  massCreateDefaultsLegacySchema,
]);

const massCreateRowOverridesCommercialSchema = z.object({
  contentPreset: runContentPresetSchema.optional(),
  venomousPlannedBossCount: venomousPlannedBossCountSchema.optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  lootType: z.enum(RUN_LOOT_TYPES).optional(),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema.optional(),
  desiredHealerCount: compositionSchema.optional(),
  desiredDpsCount: compositionSchema.optional(),
  discordRolePing: z.boolean().optional(),
});

const massCreateRowOverridesLegacySchema = z.object({
  raidId: entityIdSchema.optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  lootType: z.enum(RUN_LOOT_TYPES).optional(),
  raidLeadId: entityIdSchema.optional(),
  notes: notesSchema,
  desiredTankCount: compositionSchema.optional(),
  desiredHealerCount: compositionSchema.optional(),
  desiredDpsCount: compositionSchema.optional(),
  plannedBossCount: plannedBossCountSchema.optional(),
  discordRolePing: z.boolean().optional(),
});

const massCreateRowOverridesSchema = z.union([
  massCreateRowOverridesCommercialSchema,
  massCreateRowOverridesLegacySchema,
]);

const massCreateRowSchema = z.object({
  scheduledStartAt: scheduledStartAtSchema,
  overrides: massCreateRowOverridesSchema.optional(),
});

export const createManyRunsSchema = z.object({
  defaults: massCreateDefaultsSchema,
  runs: z
    .array(massCreateRowSchema)
    .min(MASS_CREATE_MIN_RUNS, "Add at least one run.")
    .max(MASS_CREATE_MAX_RUNS, `You can create at most ${MASS_CREATE_MAX_RUNS} runs at once.`),
  templateId: entityIdSchema.optional(),
});

export type CreateManyRunsInput = z.infer<typeof createManyRunsSchema>;
export type MassCreateDefaults = CreateManyRunsInput["defaults"];
export type MassCreateRunRow = CreateManyRunsInput["runs"][number];
export type MassCreateRowOverrides = NonNullable<MassCreateRunRow["overrides"]>;
