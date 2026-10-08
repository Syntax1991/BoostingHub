import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { compositionSchema, notesSchema, productSelectionShape } from "@/validators/run";

export const RUN_TEMPLATE_NAME_MAX = 80;

export const runTemplateNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a template name.")
  .max(RUN_TEMPLATE_NAME_MAX, "Template name is too long.");

// Global Run Setup — no Raid Lead. Content is a persisted Product selection
// (same authority as Create Run). Composition fields are DEFAULT values
// inherited by Schedule slots unless a slot overrides them.
export const createRunTemplateSchema = z.object({
  name: runTemplateNameSchema,
  ...productSelectionShape,
  difficulty: z.enum(RAID_DIFFICULTIES),
  lootType: z.enum(RUN_LOOT_TYPES),
  desiredTankCount: compositionSchema,
  desiredHealerCount: compositionSchema,
  desiredDpsCount: compositionSchema,
  desiredLootbuddyCount: compositionSchema.optional(),
  notes: notesSchema,
});

export const updateRunTemplateSchema = createRunTemplateSchema.extend({
  templateId: entityIdSchema,
});

export const templateIdSchema = z.object({
  templateId: entityIdSchema,
});

export const manageTemplateFiltersSchema = z.object({
  status: z.enum(["active", "inactive", "all"]).optional(),
});

export type CreateRunTemplateInput = z.infer<typeof createRunTemplateSchema>;
export type UpdateRunTemplateInput = z.infer<typeof updateRunTemplateSchema>;
export type ManageTemplateFiltersInput = z.infer<typeof manageTemplateFiltersSchema>;

export function parseManageTemplateFilters(searchParams: {
  status?: string | string[];
}): ManageTemplateFiltersInput {
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const parsed = manageTemplateFiltersSchema.safeParse({
    status: first(searchParams.status) || undefined,
  });
  return parsed.success ? parsed.data : {};
}
