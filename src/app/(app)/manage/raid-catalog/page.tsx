import { managementController } from "@/controllers/app.controller";
import { ManageRaidCatalogView } from "@/components/manage/raid-catalog/manage-raid-catalog-view";
import { resolveRaidCatalogTab } from "@/components/manage/raid-catalog/raid-catalog-tabs";

export default async function ManageRaidCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [page, params] = await Promise.all([managementController.getRaidCatalogPage(), searchParams]);
  return <ManageRaidCatalogView page={page} tab={resolveRaidCatalogTab(params.tab)} />;
}
