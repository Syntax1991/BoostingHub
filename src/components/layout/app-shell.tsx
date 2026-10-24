"use client";

import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  LayoutDashboard,
  Menu,
  Settings,
  Shield,
  Swords,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { APP_BRAND_NAME, APP_BRAND_TAGLINE } from "@/lib/branding";
import { BrandLogo } from "@/components/layout/brand-logo";
import type { AccountRole } from "@/models/enums";
import {
  canAccessManagement,
  getManagementNavItems,
  isManagementNavActive,
} from "@/auth/authorization";
import { ROLE_LABELS } from "@/lib/labels";
import { signOutAction } from "@/controllers/auth.actions";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationBellItem } from "@/services/notification.service";

/** Authoritative primary navigation — desktop sidebar and mobile drawer share this list. */
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: Swords },
  { href: "/my-runs", label: "My Runs", icon: CalendarDays },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isPrimaryNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  user,
  notifications,
  timeZone,
}: {
  children: React.ReactNode;
  user: {
    name: string;
    image: string | null;
    accountRole: AccountRole;
  };
  notifications: {
    unreadCount: number;
    latest: NotificationBellItem[];
  };
  timeZone: string;
}) {
  const pathname = usePathname();
  const showManage = canAccessManagement(user.accountRole);
  const manageNav = showManage ? getManagementNavItems(user.accountRole) : [];
  const onManageRoute = pathname.startsWith("/manage");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerTitleId = useId();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <BrandLogo size={32} />
          <div>
            <p className="text-sm font-semibold">{APP_BRAND_NAME}</p>
            <p className="text-[11px] text-muted">{APP_BRAND_TAGLINE}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Primary">
          {NAV.map((item) => {
            const active = isPrimaryNavActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                  active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {showManage ? (
            <div className="mt-3">
              <Link
                href="/manage"
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                  onManageRoute
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
                aria-current={onManageRoute && pathname === "/manage" ? "page" : undefined}
              >
                <Shield className="h-4 w-4" />
                Manage
              </Link>
              <div className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-border pl-2">
                {manageNav.map((item) => {
                  const active = isManagementNavActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "rounded-md px-2 py-1.5 text-xs",
                        active
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-surface-raised hover:text-foreground",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[70px] items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <button
              type="button"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground",
                mobileNavOpen && "bg-surface-raised text-foreground",
              )}
              aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation-drawer"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
            <BrandLogo size={28} />
            {/* The emblem carries the brand on narrow screens; the name stays for screen readers. */}
            <p className="sr-only">{APP_BRAND_NAME}</p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <NotificationBell
              unreadCount={notifications.unreadCount}
              latest={notifications.latest}
              timeZone={timeZone}
            />
            {/*
              Below `sm` the name/role text would push this row past a phone's width
              (the whole page then scrolls sideways). The avatar stays visible, the text
              stays for screen readers, and Profile shows the full identity.
            */}
            <div className="sr-only min-w-0 text-right sm:not-sr-only">
              <p className="max-w-[180px] truncate text-sm font-medium">{user.name}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">
                {ROLE_LABELS[user.accountRole]}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-xs font-semibold">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        {showManage && onManageRoute ? (
          <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden">
            {manageNav.map((item) => {
              const active = isManagementNavActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-xs",
                    active ? "bg-accent/15 text-accent" : "text-muted",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ) : null}
        <main className="flex-1 overflow-x-hidden px-4 py-5 md:px-6">{children}</main>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={closeMobileNav}
          />
          <div
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="absolute inset-y-0 left-0 flex w-[min(85vw,20rem)] max-w-full flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <BrandLogo size={28} />
                <p id={drawerTitleId} className="truncate text-sm font-semibold">
                  {APP_BRAND_NAME}
                </p>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground"
                aria-label="Close navigation menu"
                onClick={closeMobileNav}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3"
              aria-label="Mobile"
            >
              <div>
                <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Main
                </p>
                <div className="flex flex-col gap-0.5">
                  {NAV.map((item) => {
                    const active = isPrimaryNavActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMobileNav}
                        className={cn(
                          "flex min-h-11 items-center gap-2 rounded-md px-2.5 py-2.5 text-sm",
                          active
                            ? "bg-accent/15 text-accent"
                            : "text-muted hover:bg-surface-raised hover:text-foreground",
                        )}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              {showManage ? (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <Shield className="h-3.5 w-3.5" aria-hidden />
                    Management
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {manageNav.map((item) => {
                      const active = isManagementNavActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={closeMobileNav}
                          className={cn(
                            "flex min-h-11 items-center rounded-md px-2.5 py-2.5 text-sm",
                            active
                              ? "bg-accent/15 text-accent"
                              : "text-muted hover:bg-surface-raised hover:text-foreground",
                          )}
                          aria-current={active ? "page" : undefined}
                        >
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
