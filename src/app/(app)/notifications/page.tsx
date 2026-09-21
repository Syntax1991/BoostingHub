import { notificationController } from "@/controllers/app.controller";
import { NotificationsView } from "@/components/notifications/notifications-view";

export default async function NotificationsPage() {
  const data = await notificationController.getNotificationsPage();
  return <NotificationsView notifications={data.notifications} unreadCount={data.unreadCount} />;
}
