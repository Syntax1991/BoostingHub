import { redirect } from "next/navigation";

/**
 * Historical /manage/booster-access URLs redirect into the canonical Users
 * Pending Boosting Access view (via the former Boosting Roles legacy tab).
 */
export default async function ManageBoosterAccessRedirect({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const pending = first(params.view) === "legacy" || first(params.status) === "PENDING";
  redirect(pending ? "/manage/users?view=boosting-access" : "/manage/users");
}
