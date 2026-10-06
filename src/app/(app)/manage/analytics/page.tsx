import { managementController } from "@/controllers/app.controller";
import { ManageAnalyticsView } from "@/components/manage/manage-analytics-view";

export default async function ManageAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const report = await managementController.getAnalyticsPage(params);
  return <ManageAnalyticsView report={report} />;
}
