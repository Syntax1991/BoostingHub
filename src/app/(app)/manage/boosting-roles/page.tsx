import { redirect } from "next/navigation";

/**
 * Boosting Roles / legacy request review live on the canonical Users surface.
 * Preserve bookmarks: roles overview → All Users; legacy → Pending Boosting Access.
 */
export default async function ManageBoostingRolesRedirect({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    role?: string | string[];
    query?: string | string[];
    difficulty?: string | string[];
    requestedRole?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const href = new URLSearchParams();
  const legacy = first(params.view) === "legacy";
  if (legacy) {
    href.set("view", "boosting-access");
    const difficulty = first(params.difficulty);
    const requestedRole = first(params.requestedRole);
    const query = first(params.query);
    if (difficulty) href.set("difficulty", difficulty);
    if (requestedRole) href.set("requestedRole", requestedRole);
    if (query) href.set("query", query);
  } else {
    const boostingRole = first(params.role);
    const query = first(params.query);
    if (boostingRole && boostingRole !== "ALL") href.set("boostingRole", boostingRole);
    if (query) href.set("query", query);
  }
  const query = href.toString();
  redirect(query ? `/manage/users?${query}` : "/manage/users");
}
