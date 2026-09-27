import { managementController } from "@/controllers/app.controller";
import { BoostingRolesView } from "@/components/manage/boosting-roles-view";

export default async function ManageBoostingRolesPage({
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
  const data = await managementController.getBoostingRolesPage(await searchParams);
  return <BoostingRolesView data={data} />;
}
