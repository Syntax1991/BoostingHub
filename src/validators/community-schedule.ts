import { z } from "zod";
import {
  COMMUNITY_SCHEDULE_LABEL_MAX,
  COMMUNITY_SCHEDULE_NOTES_MAX,
  isCommunityWeekday,
  parseCommunityLocalStartTime,
} from "@/lib/community-schedule";
import { COMMUNITY_WEEKDAYS } from "@/models/enums";

const weekdaySchema = z
  .string()
  .refine((value) => isCommunityWeekday(value), { message: "Choose a valid weekday." })
  .transform((value) => value as (typeof COMMUNITY_WEEKDAYS)[number]);

const localStartTimeSchema = z.string().transform((value, ctx) => {
  try {
    return parseCommunityLocalStartTime(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use HH:mm (24-hour)." });
    return z.NEVER;
  }
});

const labelSchema = z
  .string()
  .trim()
  .min(1, "Enter a label.")
  .max(COMMUNITY_SCHEDULE_LABEL_MAX, `Label must be at most ${COMMUNITY_SCHEDULE_LABEL_MAX} characters.`);

const notesSchema = z
  .string()
  .trim()
  .max(COMMUNITY_SCHEDULE_NOTES_MAX, `Notes must be at most ${COMMUNITY_SCHEDULE_NOTES_MAX} characters.`)
  .optional()
  .nullable()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });

const runTemplateIdSchema = z
  .string()
  .uuid("Choose a valid run template.")
  .optional()
  .nullable()
  .transform((value) => value ?? null);

export const createCommunityScheduleSlotSchema = z.object({
  weekday: weekdaySchema,
  localStartTime: localStartTimeSchema,
  label: labelSchema,
  raidLeadId: z.string().uuid("Choose an eligible raid lead."),
  notes: notesSchema,
  runTemplateId: runTemplateIdSchema,
  autoCreateRun: z.boolean().optional().default(false),
});

export const updateCommunityScheduleSlotSchema = createCommunityScheduleSlotSchema.extend({
  slotId: z.string().uuid(),
});

export const communityScheduleSlotIdSchema = z.object({
  slotId: z.string().uuid(),
});

export const materializeCommunityScheduleOccurrenceSchema = z.object({
  scheduleSlotId: z.string().uuid(),
  window: z.enum(["CURRENT", "NEXT"]),
});

export type CreateCommunityScheduleSlotInput = z.infer<typeof createCommunityScheduleSlotSchema>;
export type UpdateCommunityScheduleSlotInput = z.infer<typeof updateCommunityScheduleSlotSchema>;
export type MaterializeCommunityScheduleOccurrenceInput = z.infer<
  typeof materializeCommunityScheduleOccurrenceSchema
>;
