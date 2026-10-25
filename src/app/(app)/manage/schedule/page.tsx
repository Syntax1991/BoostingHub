import { managementController } from "@/controllers/app.controller";
import { ManageCommunityScheduleView } from "@/components/manage/manage-community-schedule-view";

export default async function ManageSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  const params = await searchParams;
  const created = Array.isArray(params.created) ? params.created[0] : params.created;
  const page = await managementController.getManageSchedulePage();
  return <ManageCommunityScheduleView page={page} justCreated={created === "1"} />;
}
