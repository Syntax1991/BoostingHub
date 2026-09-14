import { z } from "zod";
import { CHARACTER_ROLES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const rosterRunSchema = z.object({
  runId: entityIdSchema,
});

export const rosterDraftSelectionSchema = z.object({
  runId: entityIdSchema,
  signupId: entityIdSchema,
  selected: z.boolean(),
  version: z.number().int().positive(),
  /** Omitted for a single-role booster offer (auto-resolved) and for lootbuddy slots. */
  selectedRole: z.enum(CHARACTER_ROLES).nullish(),
});

/** One draft roster slot: the signup, plus the role the raid lead assigns it. */
const rosterSelectionSchema = z.object({
  signupId: entityIdSchema,
  selectedRole: z.enum(CHARACTER_ROLES).nullable(),
});

export const saveRosterDraftSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  selections: z.array(rosterSelectionSchema),
});

export const rosterVersionSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
});

export const publishRosterSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  acknowledgeWarnings: z.boolean(),
});
