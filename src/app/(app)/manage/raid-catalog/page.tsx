import { managementController } from "@/controllers/app.controller";
import { ManageRaidCatalogView } from "@/components/manage/raid-catalog/manage-raid-catalog-view";

export default async function ManageRaidCatalogPage() {
  const page = await managementController.getRaidCatalogPage();
  return <ManageRaidCatalogView page={page} />;
}
