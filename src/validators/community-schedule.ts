import { z } from "zod";
import {
  COMMUNITY_SCHEDULE_LABEL_MAX,
  COMMUNITY_SCHEDULE_NOTES_MAX,
  MAX_SLOTS_PER_PLAN,
  isCommunityWeekday,
  parseCommunityLocalStartTime,
} from "@/lib/community-schedule";
import { COMMUNITY_SCHEDULE_RUN_MODES, COMMUNITY_WEEKDAYS } from "@/models/enums";
import {
  createRunTemplateSchema,
} from "@/validators/run-template";

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
  .uuid("Choose a valid run setup.")
  .optional()
  .nullable()
  .transform((value) => value ?? null);

const runModeSchema = z
  .enum(COMMUNITY_SCHEDULE_RUN_MODES)
  .optional()
  .default("INHOUSE");

const planSlotSchema = z.object({
  weekday: weekdaySchema,
  localStartTime: localStartTimeSchema,
  runMode: runModeSchema,
});

function refineUniquePlanSlots<T extends { slots: Array<{ weekday: string; localStartTime: string }> }>(
  schema: z.ZodType<T>,
) {
  return schema.superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < value.slots.length; index += 1) {
      const slot = value.slots[index]!;
      const key = `${slot.weekday}\0${slot.localStartTime}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate weekday and time in this batch.",
          path: ["slots", index],
        });
        return;
      }
      seen.add(key);
    }
  });
}

const createRunSetupFieldsSchema = createRunTemplateSchema.omit({ raidLeadId: true });

export const createCommunityScheduleSlotSchema = z.object({
  weekday: weekdaySchema,
  localStartTime: localStartTimeSchema,
  label: labelSchema,
  raidLeadId: z.string().uuid("Choose an eligible raid lead."),
  notes: notesSchema,
  runTemplateId: runTemplateIdSchema,
  autoCreateRun: z.boolean().optional().default(false),
  runMode: runModeSchema,
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

export const createSchedulePlanSchema = refineUniquePlanSlots(
  z.object({
    raidLeadId: z.string().uuid("Choose an eligible raid lead."),
    runSetup: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("existing"),
        templateId: z.string().uuid("Choose a valid run setup."),
      }),
      z.object({
        mode: z.literal("create"),
        ...createRunSetupFieldsSchema.shape,
      }),
    ]),
    slots: z
      .array(planSlotSchema)
      .min(1, "Add at least one weekly time.")
      .max(MAX_SLOTS_PER_PLAN, `At most ${MAX_SLOTS_PER_PLAN} times per plan.`),
    autoCreateRun: z.boolean(),
    notes: notesSchema,
  }),
);

export const addScheduleTimesSchema = refineUniquePlanSlots(
  z.object({
    runTemplateId: z.string().uuid("Choose a valid run setup."),
    raidLeadId: z.string().uuid("Choose an eligible raid lead."),
    slots: z
      .array(planSlotSchema)
      .min(1, "Add at least one weekly time.")
      .max(MAX_SLOTS_PER_PLAN, `At most ${MAX_SLOTS_PER_PLAN} times per plan.`),
    autoCreateRun: z.boolean(),
    notes: notesSchema,
  }),
);

export type CreateCommunityScheduleSlotInput = z.infer<typeof createCommunityScheduleSlotSchema>;
export type UpdateCommunityScheduleSlotInput = z.infer<typeof updateCommunityScheduleSlotSchema>;
export type MaterializeCommunityScheduleOccurrenceInput = z.infer<
  typeof materializeCommunityScheduleOccurrenceSchema
>;
export type CreateSchedulePlanInput = z.infer<typeof createSchedulePlanSchema>;
export type AddScheduleTimesInput = z.infer<typeof addScheduleTimesSchema>;
