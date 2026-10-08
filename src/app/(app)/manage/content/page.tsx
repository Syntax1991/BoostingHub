import { managementController } from "@/controllers/app.controller";
import { ManageContentView } from "@/components/manage/content/manage-content-view";

export default async function ManageContentPage() {
  const page = await managementController.getContentPage();
  return <ManageContentView page={page} />;
}
