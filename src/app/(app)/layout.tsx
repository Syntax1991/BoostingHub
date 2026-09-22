import type { ReactNode } from "react";
import { requireUserOrRedirect } from "@/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { notificationService } from "@/services/notification.service";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUserOrRedirect("/dashboard");
  const notifications = await notificationService.getBellData(user);

  return (
    <AppShell
      user={{
        name: user.name,
        image: user.image,
        accountRole: user.accountRole,
      }}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}
