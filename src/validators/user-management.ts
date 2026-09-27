import { z } from "zod";
import { ACCOUNT_ROLES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { parseBoostingRoleFilter } from "@/validators/boosting-roles";

export const changeAccountRoleSchema = z.object({
  targetUserId: entityIdSchema,
  nextRole: z.enum(ACCOUNT_ROLES),
});

export type AdminUserListSort = "name" | "joined_desc" | "joined_asc" | "role";

export function parseAdminUserFilters(searchParams: {
  query?: string | string[];
  role?: string | string[];
  boostingRole?: string | string[];
  sort?: string | string[];
}) {
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;

  const query = first(searchParams.query)?.trim() || undefined;
  const roleRaw = first(searchParams.role);
  const role =
    roleRaw && (ACCOUNT_ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as (typeof ACCOUNT_ROLES)[number])
      : undefined;

  const boostingRole = parseBoostingRoleFilter(first(searchParams.boostingRole));

  const sortRaw = first(searchParams.sort);
  const sort: AdminUserListSort =
    sortRaw === "joined_desc" ||
    sortRaw === "joined_asc" ||
    sortRaw === "role" ||
    sortRaw === "name"
      ? sortRaw
      : "name";

  return { query, role, boostingRole, sort };
}
