import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";

export const rosterRunSchema = z.object({
  runId: entityIdSchema,
});

export const rosterDraftSelectionSchema = z.object({
  runId: entityIdSchema,
  signupId: entityIdSchema,
  selected: z.boolean(),
  version: z.number().int().positive(),
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
