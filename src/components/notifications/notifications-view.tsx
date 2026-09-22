"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/controllers/notification.actions";
import type { NotificationBellItem } from "@/services/notification.service";
import { cn } from "@/lib/cn";

export function NotificationsView({
  notifications,
  unreadCount,
  timeZone,
}: {
  notifications: NotificationBellItem[];
  unreadCount: number;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markOne(notificationId: string, href: string) {
    setError(null);
    startTransition(async () => {
      const result = await markNotificationReadAction({ notificationId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(href || "/notifications");
      router.refresh();
    });
  }

  function markAll() {
    setError(null);
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="In-app alerts for roster and run events. Discord DMs are controlled in Settings."
        actions={
          unreadCount > 0 ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={markAll}>
              Mark all read
            </Button>
          ) : null
        }
      />
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <Card>
        <CardHeader title="Recent" description={`${unreadCount} unread`} />
        {notifications.length === 0 ? (
          <EmptyState title="No notifications yet." description="Roster picks and raid invites will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((item) => (
              <li key={item.id} className={cn("px-4 py-3", !item.readAt && "bg-accent/5")}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{item.message}</p>
                    <p className="mt-1 text-xs text-muted">{formatDateTime(item.createdAt, timeZone)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!item.readAt ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-xs"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const result = await markNotificationReadAction({ notificationId: item.id });
                            if (!result.ok) {
                              setError(result.message);
                              return;
                            }
                            router.refresh();
                          });
                        }}
                      >
                        Mark read
                      </Button>
                    ) : null}
                    {item.href ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="text-xs"
                        disabled={pending}
                        onClick={() => markOne(item.id, item.href)}
                      >
                        Open
                      </Button>
                    ) : (
                      <Link href="/notifications" className="text-xs text-accent hover:underline">
                        Details
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
