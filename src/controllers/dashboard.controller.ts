import { requireUserOrRedirect } from "@/auth/session";
import { formatRelative } from "@/lib/datetime";
import { dashboardService } from "@/services/dashboard.service";

export const dashboardController = {
  async getDashboard() {
    const user = await requireUserOrRedirect("/dashboard");
    const data = await dashboardService.getDashboard(user);
    return {
      ...data,
      recentActivity: data.recentActivity.map((event) => ({
        ...event,
        occurredAtLabel: formatRelative(event.occurredAt),
      })),
    };
  },
};
