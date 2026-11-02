import { notificationController, settingsController } from "@/controllers/app.controller";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { requireUser } from "@/auth/session";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    notificationController.getNotificationsPage(),
    settingsController.getTimeZone(user.id),
  ]);
  return (
    <NotificationsView
      notifications={data.notifications}
      unreadCount={data.unreadCount}
      timeZone={timeZone}
    />
  );
}
