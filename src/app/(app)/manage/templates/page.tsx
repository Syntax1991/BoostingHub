import { managementController } from "@/controllers/app.controller";
import { ManageTemplatesView } from "@/components/templates/manage-templates-view";

export default async function ManageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    raidLeadId?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const data = await managementController.getManageTemplatesPage(params);
  return <ManageTemplatesView data={data} />;
}
