import { dashboardController } from "@/controllers/dashboard.controller";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function DashboardPage() {
  const data = await dashboardController.getDashboard();
  return <DashboardView data={data} />;
}
