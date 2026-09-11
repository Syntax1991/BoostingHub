import { managementController } from "@/controllers/app.controller";
import { ManageRunsView } from "@/components/manage/manage-views";

export default async function ManageRunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    raidLeadId?: string | string[];
    timeframe?: string | string[];
    archived?: string | string[];
  }>;
}) {
  const data = await managementController.getManageRunsPage(await searchParams);
  return <ManageRunsView data={data} />;
}
