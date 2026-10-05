import { managementController } from "@/controllers/app.controller";
import { ManageSystemHealthView } from "@/components/manage/manage-system-health-view";

export default async function ManageSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = await managementController.getSystemHealthPage(params);
  return <ManageSystemHealthView page={page} />;
}
