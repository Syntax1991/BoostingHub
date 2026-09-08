import type { ReactNode } from "react";
import { requireUserOrRedirect } from "@/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUserOrRedirect("/dashboard");

  return (
    <AppShell
      user={{
        name: user.name,
        image: user.image,
        accountRole: user.accountRole,
      }}
    >
      {children}
    </AppShell>
  );
}
