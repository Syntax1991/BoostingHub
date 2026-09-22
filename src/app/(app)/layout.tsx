import type { ReactNode } from "react";
import { requireUserOrRedirect } from "@/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { settingsRepository } from "@/repositories/settings.repository";
import { notificationService } from "@/services/notification.service";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUserOrRedirect("/dashboard");
  const [notifications, timeZone] = await Promise.all([
    notificationService.getBellData(user),
    settingsRepository.getTimeZone(user.id),
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
