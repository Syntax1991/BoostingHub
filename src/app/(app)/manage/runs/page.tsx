import { managementController } from "@/controllers/app.controller";
import { ManageRunsView } from "@/components/manage/manage-views";

export default async function ManageRunsPage() {
  const runs = await managementController.getManageRunsPage();
  return <ManageRunsView runs={runs} />;
}
