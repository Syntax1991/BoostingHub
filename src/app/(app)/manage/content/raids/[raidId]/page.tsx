import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { managementController } from "@/controllers/app.controller";
import { ManageContentRaidView } from "@/components/manage/content/manage-content-raid-view";

export default async function ManageContentRaidPage({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  let page: Awaited<ReturnType<typeof managementController.getContentRaidPage>>;
  try {
    page = await managementController.getContentRaidPage(raidId);
  } catch (error) {
    if (isDomainError(error) && error.code === "CONTENT_RAID_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  return <ManageContentRaidView raid={page.raid} seasons={page.seasons} />;
}
