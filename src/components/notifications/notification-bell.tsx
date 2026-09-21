"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/datetime";
import { markNotificationReadAction } from "@/controllers/notification.actions";
import type { NotificationBellItem } from "@/services/notification.service";

export function NotificationBell({
  unreadCount,
  latest,
}: {
  unreadCount: number;
  latest: NotificationBellItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openNotification(item: NotificationBellItem) {
    startTransition(async () => {
      if (!item.readAt) {
        await markNotificationReadAction({ notificationId: item.id });
      }
      setOpen(false);
      router.push(item.href || "/notifications");
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground",
          open && "bg-surface-raised text-foreground",
        )}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-background">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Recent notifications"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-[11px] text-muted">
              {unreadCount > 0 ? `${unreadCount} unread` : "You're caught up"}
            </p>
          </div>
          {latest.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted">No notifications yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {latest.map((item) => (
                <li key={item.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => openNotification(item)}
                    className={cn(
                      "block w-full px-3 py-2.5 text-left hover:bg-surface-raised",
                      !item.readAt && "bg-accent/5",
                    )}
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.message}</p>
                    <p className="mt-1 text-[11px] text-muted">{formatDateTime(item.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-3 py-2">
            <Link
              href="/notifications"
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
