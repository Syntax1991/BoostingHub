import { notificationController } from "@/controllers/app.controller";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { requireUser } from "@/auth/session";
import { settingsRepository } from "@/repositories/settings.repository";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    notificationController.getNotificationsPage(),
    settingsRepository.getTimeZone(user.id),
  ]);
  return (
    <NotificationsView
      notifications={data.notifications}
      unreadCount={data.unreadCount}
      timeZone={timeZone}
    />
  );
}
