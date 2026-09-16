import { z } from "zod";
import { entityIdSchema } from "@/validators/ids";
import { AVAILABILITY_REASON_MAX } from "@/services/character-availability.service";

const instantSchema = z
  .string()
  .trim()
  .min(1, "Choose a time.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.");

const reasonSchema = z
  .string()
  .trim()
  .max(AVAILABILITY_REASON_MAX, `Reason must be at most ${AVAILABILITY_REASON_MAX} characters.`)
  .optional()
  .nullable();

export const createAvailabilityBlockSchema = z.object({
  characterId: entityIdSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
  reason: reasonSchema,
});

export const updateAvailabilityBlockSchema = z.object({
  blockId: entityIdSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
  reason: reasonSchema,
});

export const availabilityBlockIdSchema = z.object({
  blockId: entityIdSchema,
});
