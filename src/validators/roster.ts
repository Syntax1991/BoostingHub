import { z } from "zod";
import { CHARACTER_ROLES, PARTICIPATION_TYPES, WOW_CLASSES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

/** One hand-added external: a booster (role required) or a lootbuddy (no role). Older clients omit the type → booster. */
const externalBoosterEntrySchema = z.object({
  name: z.string().max(64),
  wowClass: z.enum(WOW_CLASSES),
  participationType: z.enum(PARTICIPATION_TYPES).optional(),
  role: z.enum(CHARACTER_ROLES).nullable(),
});

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
  /** Hand-added unregistered boosters; full set, replaces the saved ones. Name rules live in lib/external-booster.ts. */
  externalBoosters: z
    .array(
      externalBoosterEntrySchema,
    )
    .max(100)
    .optional(),
});

export const saveExternalBoostersSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  externalBoosters: z
    .array(
      externalBoosterEntrySchema,
    )
    .max(100),
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

/** Add Player: bounded player search for a Run the actor manages. */
export const rosterPlayerSearchSchema = z.object({
  runId: entityIdSchema,
  query: z.string().trim().min(2, "Type at least 2 characters.").max(64),
});

/** Add Player: the chosen player's Characters for this Run. */
export const rosterManualAddOptionsSchema = z.object({
  runId: entityIdSchema,
  userId: entityIdSchema,
});

/** Add Player: roster a registered player's Character as a Booster in the assigned role. */
export const rosterAddPlayerSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  userId: entityIdSchema,
  characterId: entityIdSchema,
  role: z.enum(CHARACTER_ROLES),
});

/** Update Roster: accept the manager's current selection as the published roster (one action). */
export const updateRosterSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  selections: z.array(rosterSelectionSchema),
  acknowledgeWarnings: z.boolean(),
});

/** Publish Roster on a published roster: explicit repost, compare-and-set on version AND postRevision. */
export const repostRosterSchema = z.object({
  runId: entityIdSchema,
  version: z.number().int().positive(),
  postRevision: z.number().int().min(0),
});
