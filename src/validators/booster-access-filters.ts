import { z } from "zod";
import { CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const ADMIN_ACCESS_VIEWS = ["qualifications", "legacy"] as const;
export type AdminAccessView = (typeof ADMIN_ACCESS_VIEWS)[number];

/** Qualification filters never include PENDING — that belongs to Legacy Requests. */
export const QUALIFICATION_STATUSES = ["ALL", "APPROVED", "REJECTED", "REVOKED"] as const;
export type QualificationStatusFilter = (typeof QUALIFICATION_STATUSES)[number];

const adminAccessFilterSchema = z.object({
  view: z.enum(ADMIN_ACCESS_VIEWS).optional(),
  status: z.enum(QUALIFICATION_STATUSES).optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  role: z.enum(CHARACTER_ROLES).optional(),
  query: z.string().trim().max(80).optional(),
  userId: entityIdSchema.optional(),
});

export type AdminAccessFilterInput = z.infer<typeof adminAccessFilterSchema>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAdminAccessFilters(searchParams: {
  view?: string | string[];
  status?: string | string[];
  difficulty?: string | string[];
  role?: string | string[];
  query?: string | string[];
  userId?: string | string[];
}): AdminAccessFilterInput {
  const rawView = first(searchParams.view);
  // Backward-compat: old ?status=PENDING links open Legacy Requests.
  const rawStatus = first(searchParams.status);
  const inferredView =
    rawView === "legacy" || rawStatus === "PENDING" ? "legacy" : "qualifications";

  const parsed = adminAccessFilterSchema.safeParse({
    view: inferredView,
    status:
      rawStatus && (QUALIFICATION_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus
        : undefined,
    difficulty: first(searchParams.difficulty) || undefined,
    role: first(searchParams.role) || undefined,
    query: first(searchParams.query) || undefined,
    userId: first(searchParams.userId) || undefined,
  });

  if (!parsed.success) {
    return { view: "qualifications", status: "ALL" };
  }

  return {
    ...parsed.data,
    view: parsed.data.view ?? "qualifications",
    status: parsed.data.view === "legacy" ? undefined : (parsed.data.status ?? "ALL"),
  };
}
