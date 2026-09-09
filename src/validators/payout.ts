import { z } from "zod";
import {
  PAYOUT_ADJUSTMENT_REASON_MAX,
  SHARE_UNITS_MAX,
  SHARE_UNITS_MIN,
  TOTAL_GOLD_MAX,
  TOTAL_GOLD_MIN,
} from "@/services/payout-state";
import { entityIdSchema } from "@/validators/ids";

export const prepareRunPayoutSchema = z.object({
  runId: entityIdSchema,
  totalGold: z.number().int().min(TOTAL_GOLD_MIN).max(TOTAL_GOLD_MAX),
});

export const updateRunPayoutTotalSchema = z.object({
  settlementId: entityIdSchema,
  totalGold: z.number().int().min(TOTAL_GOLD_MIN).max(TOTAL_GOLD_MAX),
});

export const updateRunPayoutShareSchema = z.object({
  payoutEntryId: entityIdSchema,
  shareUnits: z.number().int().min(SHARE_UNITS_MIN).max(SHARE_UNITS_MAX),
  adjustmentReason: z
    .string()
    .trim()
    .max(PAYOUT_ADJUSTMENT_REASON_MAX, `Adjustment reasons must be ${PAYOUT_ADJUSTMENT_REASON_MAX} characters or fewer.`)
    .optional()
    .nullable(),
});

export const finalizeRunPayoutSchema = z.object({
  settlementId: entityIdSchema,
});

export const markRunPayoutPaidSchema = z.object({
  settlementId: entityIdSchema,
});
