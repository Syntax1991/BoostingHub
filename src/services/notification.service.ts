import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  userNotificationRepository,
  type UserNotificationRecord,
} from "@/repositories/user-notification.repository";

export type NotificationBellItem = {
  id: string;
  type: UserNotificationRecord["type"];
  title: string;
  message: string;
  href: string;
  readAt: string | null;
  createdAt: string;
};

function toBellItem(row: UserNotificationRecord): NotificationBellItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    href: row.href,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export const notificationService = {
  async getBellData(user: AuthenticatedUser): Promise<{
    unreadCount: number;
    latest: NotificationBellItem[];
  }> {
    const [unreadCount, latest] = await Promise.all([
      userNotificationRepository.countUnreadForUser(user.id),
      userNotificationRepository.listLatestForUser(user.id, 5),
    ]);
    return {
      unreadCount,
      latest: latest.map(toBellItem),
    };
  },

  async listPage(user: AuthenticatedUser): Promise<{
    notifications: NotificationBellItem[];
    unreadCount: number;
  }> {
    const [notifications, unreadCount] = await Promise.all([
      userNotificationRepository.listForUser(user.id, 100),
      userNotificationRepository.countUnreadForUser(user.id),
    ]);
    return {
      notifications: notifications.map(toBellItem),
      unreadCount,
    };
  },

  async markRead(user: AuthenticatedUser, notificationId: string): Promise<NotificationBellItem> {
    const owned = await userNotificationRepository.findOwned(user.id, notificationId);
    if (!owned) {
      throw new DomainError("NOT_FOUND", "Notification was not found.", 404);
    }
    const updated = await userNotificationRepository.markRead(user.id, notificationId);
    if (!updated) {
      throw new DomainError("NOT_FOUND", "Notification was not found.", 404);
    }
    return toBellItem(updated);
  },

  async markAllRead(user: AuthenticatedUser): Promise<{ marked: number }> {
    const marked = await userNotificationRepository.markAllRead(user.id);
    return { marked };
  },
};
