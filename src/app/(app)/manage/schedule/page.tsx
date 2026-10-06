import { managementController } from "@/controllers/app.controller";
import { ManageCommunityScheduleView } from "@/components/manage/manage-community-schedule-view";

export default async function ManageSchedulePage() {
  const page = await managementController.getManageSchedulePage();
  return <ManageCommunityScheduleView page={page} />;
}
