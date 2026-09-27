import { redirect } from "next/navigation";

/**
 * Booster Access became Boosting Roles (User.isBooster / User.isLootbuddy).
 * Old links keep working: legacy-request links open the Legacy Requests tab.
 */
export default async function ManageBoosterAccessRedirect({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const legacy = first(params.view) === "legacy" || first(params.status) === "PENDING";
  redirect(legacy ? "/manage/boosting-roles?view=legacy" : "/manage/boosting-roles");
}
