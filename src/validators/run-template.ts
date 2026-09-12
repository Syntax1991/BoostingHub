import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { compositionSchema, notesSchema, plannedBossCountSchema } from "@/validators/run";

export const RUN_TEMPLATE_NAME_MAX = 80;

export const runTemplateNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a template name.")
  .max(RUN_TEMPLATE_NAME_MAX, "Template name is too long.");

// raidLeadId is accepted here only so an ADMIN can target a specific Raid
// Lead's template — the Service rejects/ignores it for a RAID_LEAD actor
// (who may only ever own their own templates) rather than trusting it.
export const createRunTemplateSchema = z.object({
  name: runTemplateNameSchema,
  raidId: entityIdSchema,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  plannedBossCount: plannedBossCountSchema,
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  notes: notesSchema,
  raidLeadId: entityIdSchema.optional(),
});

export const updateRunTemplateSchema = createRunTemplateSchema.extend({
  templateId: entityIdSchema,
});

export const templateIdSchema = z.object({
  templateId: entityIdSchema,
});

export const manageTemplateFiltersSchema = z.object({
  raidLeadId: entityIdSchema.optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
});

export type CreateRunTemplateInput = z.infer<typeof createRunTemplateSchema>;
export type UpdateRunTemplateInput = z.infer<typeof updateRunTemplateSchema>;
export type ManageTemplateFiltersInput = z.infer<typeof manageTemplateFiltersSchema>;

export function parseManageTemplateFilters(searchParams: {
  raidLeadId?: string | string[];
  status?: string | string[];
}): ManageTemplateFiltersInput {
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const parsed = manageTemplateFiltersSchema.safeParse({
    raidLeadId: first(searchParams.raidLeadId) || undefined,
    status: first(searchParams.status) || undefined,
  });
  return parsed.success ? parsed.data : {};
}
