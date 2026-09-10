import { managementController } from "@/controllers/app.controller";
import { ManageUsersView } from "@/components/manage/manage-users-view";

export default async function ManageUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string | string[];
    role?: string | string[];
    access?: string | string[];
    sort?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const data = await managementController.getUsersPage(params);
  return <ManageUsersView data={data} />;
}
