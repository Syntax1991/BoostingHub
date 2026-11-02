import type { ReactNode } from "react";
import { requireUserOrRedirect } from "@/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { settingsController } from "@/controllers/app.controller";
import { notificationService } from "@/services/notification.service";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUserOrRedirect("/dashboard");
  const [notifications, timeZone] = await Promise.all([
    notificationService.getBellData(user),
    settingsController.getTimeZone(user.id),
  ]);

  return (
    <AppShell
      user={{
        name: user.name,
        image: user.image,
        accountRole: user.accountRole,
      }}
      notifications={notifications}
      timeZone={timeZone}
    >
      {children}
    </AppShell>
  );
}
