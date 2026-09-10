import { managementController } from "@/controllers/app.controller";
import { ManageHomeView } from "@/components/manage/manage-home-view";

export default async function ManagePage() {
  const data = await managementController.getManageHomePage();
  return <ManageHomeView cards={data.cards} />;
}
