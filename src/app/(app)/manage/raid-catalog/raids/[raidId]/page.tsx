import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { managementController } from "@/controllers/app.controller";
import { ManageRaidCatalogRaidView } from "@/components/manage/raid-catalog/manage-raid-catalog-raid-view";

export default async function ManageRaidCatalogRaidPage({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  let page: Awaited<ReturnType<typeof managementController.getRaidCatalogRaidPage>>;
  try {
    page = await managementController.getRaidCatalogRaidPage(raidId);
  } catch (error) {
    if (isDomainError(error) && error.code === "CONTENT_RAID_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  return <ManageRaidCatalogRaidView raid={page.raid} seasons={page.seasons} />;
}
