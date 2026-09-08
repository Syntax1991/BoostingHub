"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  LayoutDashboard,
  Shield,
  Swords,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { AccountRole } from "@/models/enums";
import { canAccessManagement } from "@/auth/authorization";
import { ROLE_LABELS } from "@/lib/labels";
import { signOutAction } from "@/controllers/auth.actions";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: Swords },
  { href: "/my-runs", label: "My Runs", icon: CalendarDays },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: {
    name: string;
    image: string | null;
    accountRole: AccountRole;
  };
}) {
  const pathname = usePathname();
  const showManage = canAccessManagement(user.accountRole);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/15 font-mono text-sm font-bold text-accent">
            BB
          </div>
          <div>
            <p className="text-sm font-semibold">Boostting Bot</p>
            <p className="text-[11px] uppercase tracking-wider text-muted">Operations</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                  active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {showManage ? (
            <Link
              href="/manage"
              className={cn(
                "mt-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                pathname.startsWith("/manage")
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:bg-surface-raised hover:text-foreground",
              )}
            >
              <Shield className="h-4 w-4" />
              Manage
            </Link>
          ) : null}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3 md:hidden">
            <p className="text-sm font-semibold">Boostting Bot</p>
            {showManage ? (
              <Link href="/manage" className="text-xs uppercase tracking-wide text-accent">
                Manage
              </Link>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
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
        <main className="flex-1 overflow-x-hidden px-4 py-5 md:px-6">{children}</main>
        <nav className="grid grid-cols-5 border-t border-border bg-surface md:hidden">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[10px]",
                  active ? "text-accent" : "text-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
