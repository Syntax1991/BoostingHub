import { settingsController } from "@/controllers/app.controller";
import { dashboardController } from "@/controllers/dashboard.controller";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireUser } from "@/auth/session";

export default async function DashboardPage() {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    dashboardController.getDashboard(),
    settingsController.getTimeZone(user.id),
  ]);
  return <DashboardView data={data} timeZone={timeZone} />;
}
