import { z } from "zod";
import { BOOSTER_ACCESS_STATUSES, CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";

const adminAccessFilterSchema = z.object({
  status: z.enum(["ALL", ...BOOSTER_ACCESS_STATUSES]).optional(),
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  role: z.enum(CHARACTER_ROLES).optional(),
  query: z.string().trim().max(80).optional(),
});

export type AdminAccessFilterInput = z.infer<typeof adminAccessFilterSchema>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAdminAccessFilters(searchParams: {
  status?: string | string[];
  difficulty?: string | string[];
  role?: string | string[];
  query?: string | string[];
}): AdminAccessFilterInput {
  const parsed = adminAccessFilterSchema.safeParse({
    status: first(searchParams.status) || undefined,
    difficulty: first(searchParams.difficulty) || undefined,
    role: first(searchParams.role) || undefined,
    query: first(searchParams.query) || undefined,
  });
  return parsed.success ? parsed.data : { status: "PENDING" };
}
