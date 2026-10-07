import { managementController } from "@/controllers/app.controller";
import { ManageUsersView } from "@/components/manage/manage-users-view";

export default async function ManageUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    query?: string | string[];
    role?: string | string[];
    boostingRole?: string | string[];
    accountStatus?: string | string[];
    pendingAccess?: string | string[];
    sort?: string | string[];
    difficulty?: string | string[];
    requestedRole?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const data = await managementController.getUsersPage(params);
  return <ManageUsersView data={data} />;
}
