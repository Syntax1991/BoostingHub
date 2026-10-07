import { z } from "zod";
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  CHARACTER_ROLES,
  RAID_DIFFICULTIES,
} from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";
import { parseBoostingRoleFilter } from "@/validators/boosting-roles";

export const changeAccountRoleSchema = z.object({
  targetUserId: entityIdSchema,
  nextRole: z.enum(ACCOUNT_ROLES),
});

export type AdminUserListSort = "name" | "joined_desc" | "joined_asc" | "role";

/** Canonical Users admin surface views. */
export const MANAGE_USERS_VIEWS = ["users", "boosting-access"] as const;
export type ManageUsersView = (typeof MANAGE_USERS_VIEWS)[number];

export type AdminUsersPageFilters = {
  view: ManageUsersView;
  query?: string;
  role?: (typeof ACCOUNT_ROLES)[number];
  boostingRole?: ReturnType<typeof parseBoostingRoleFilter>;
  accountStatus?: (typeof ACCOUNT_STATUSES)[number];
  /** All Users: only rows with unresolved pending boosting-access requests. */
  pendingAccess?: boolean;
  sort: AdminUserListSort;
  /** Pending Boosting Access view: historical request filters. */
  difficulty?: (typeof RAID_DIFFICULTIES)[number];
  requestedRole?: (typeof CHARACTER_ROLES)[number];
};

function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

export function parseAdminUserFilters(searchParams: {
  view?: string | string[];
  query?: string | string[];
  role?: string | string[];
  boostingRole?: string | string[];
  accountStatus?: string | string[];
  pendingAccess?: string | string[];
  sort?: string | string[];
  difficulty?: string | string[];
  requestedRole?: string | string[];
}): AdminUsersPageFilters {
  const viewRaw = first(searchParams.view);
  const view: ManageUsersView =
    viewRaw === "boosting-access" || viewRaw === "legacy" ? "boosting-access" : "users";

  const query = first(searchParams.query)?.trim() || undefined;
  const roleRaw = first(searchParams.role);
  const role =
    roleRaw && (ACCOUNT_ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as (typeof ACCOUNT_ROLES)[number])
      : undefined;

  const boostingRole = parseBoostingRoleFilter(first(searchParams.boostingRole));

  const statusRaw = first(searchParams.accountStatus)?.toUpperCase();
  const accountStatus =
    statusRaw && (ACCOUNT_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as (typeof ACCOUNT_STATUSES)[number])
      : undefined;

  const pendingRaw = first(searchParams.pendingAccess)?.toLowerCase();
  const pendingAccess =
    pendingRaw === "1" || pendingRaw === "true" || pendingRaw === "yes" ? true : undefined;

  const sortRaw = first(searchParams.sort);
  const sort: AdminUserListSort =
    sortRaw === "joined_desc" ||
    sortRaw === "joined_asc" ||
    sortRaw === "role" ||
    sortRaw === "name"
      ? sortRaw
      : "name";

  const difficultyRaw = first(searchParams.difficulty);
  const difficulty =
    difficultyRaw && (RAID_DIFFICULTIES as readonly string[]).includes(difficultyRaw)
      ? (difficultyRaw as (typeof RAID_DIFFICULTIES)[number])
      : undefined;

  const requestedRoleRaw = first(searchParams.requestedRole);
  const requestedRole =
    requestedRoleRaw && (CHARACTER_ROLES as readonly string[]).includes(requestedRoleRaw)
      ? (requestedRoleRaw as (typeof CHARACTER_ROLES)[number])
      : undefined;

  return {
    view,
    query,
    role,
    boostingRole,
    accountStatus,
    pendingAccess,
    sort,
    difficulty,
    requestedRole,
  };
}
