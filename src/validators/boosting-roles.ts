import { z } from "zod";
import { BOOSTING_ROLES, type BoostingRole } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const BOOSTING_ROLE_REASON_MAX = 280;

const reasonSchema = z
  .string()
  .trim()
  .max(BOOSTING_ROLE_REASON_MAX, "Reason is too long.")
  .optional()
  .transform((value) => (value ? value : undefined));

/** Grant (enabled: true) or revoke (enabled: false) exactly one Boosting Role. */
export const setBoostingRoleSchema = z.object({
  userId: entityIdSchema,
  role: z.enum(BOOSTING_ROLES),
  enabled: z.boolean(),
  reason: reasonSchema,
});

export function parseBoostingRoleFilter(value: string | undefined): BoostingRole | "NONE" | undefined {
  const upper = value?.toUpperCase();
  if (upper === "BOOSTER" || upper === "LOOTBUDDY" || upper === "NONE") return upper;
  return undefined;
}

