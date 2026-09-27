import { z } from "zod";
import { BOOSTING_ROLES, CHARACTER_ROLES, RAID_DIFFICULTIES, type BoostingRole } from "@/models/enums";
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

/** List filter over Boosting Roles; NONE = holds neither role. */
export const BOOSTING_ROLE_FILTERS = ["ALL", "BOOSTER", "LOOTBUDDY", "NONE"] as const;
export type BoostingRoleFilter = (typeof BOOSTING_ROLE_FILTERS)[number];

export function parseBoostingRoleFilter(value: string | undefined): BoostingRole | "NONE" | undefined {
  const upper = value?.toUpperCase();
  if (upper === "BOOSTER" || upper === "LOOTBUDDY" || upper === "NONE") return upper;
  return undefined;
}

export const BOOSTING_ROLES_VIEWS = ["roles", "legacy"] as const;
export type BoostingRolesView = (typeof BOOSTING_ROLES_VIEWS)[number];

export type BoostingRolesPageFilters = {
  view: BoostingRolesView;
  /** Roles view: which Boosting Role holders to list. */
  role: BoostingRoleFilter;
  query?: string;
  /** Legacy view only: historical request filters (what was requested at the time). */
  difficulty?: (typeof RAID_DIFFICULTIES)[number];
  requestedRole?: (typeof CHARACTER_ROLES)[number];
};

const pageFilterSchema = z.object({
  query: z.string().trim().max(80).optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  requestedRole: z.enum(CHARACTER_ROLES).optional(),
});

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseBoostingRolesPageFilters(searchParams: {
  view?: string | string[];
  role?: string | string[];
  query?: string | string[];
  difficulty?: string | string[];
  requestedRole?: string | string[];
}): BoostingRolesPageFilters {
  const view: BoostingRolesView = first(searchParams.view) === "legacy" ? "legacy" : "roles";
  const role = parseBoostingRoleFilter(first(searchParams.role)) ?? "ALL";
  const parsed = pageFilterSchema.safeParse({
    query: first(searchParams.query) || undefined,
    difficulty: first(searchParams.difficulty) || undefined,
    requestedRole: first(searchParams.requestedRole) || undefined,
  });
  return { view, role, ...(parsed.success ? parsed.data : {}) };
}
