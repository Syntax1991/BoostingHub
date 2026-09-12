import { managementController } from "@/controllers/app.controller";
import { ManageRunsView } from "@/components/manage/manage-views";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ManageRunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    raidLeadId?: string | string[];
    timeframe?: string | string[];
    archived?: string | string[];
    massCreated?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const data = await managementController.getManageRunsPage(params);
  const massCreatedCount = Number(firstParam(params.massCreated));
  return (
    <ManageRunsView
      data={data}
      massCreatedCount={Number.isFinite(massCreatedCount) && massCreatedCount > 0 ? massCreatedCount : undefined}
    />
  );
}
