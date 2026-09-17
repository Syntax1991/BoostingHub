"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import {
  revokeAllSessionsAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/controllers/session.actions";
import { summarizeUserAgent, type PublicSessionView } from "@/auth/session-view";
import { signOutAction } from "@/controllers/auth.actions";

export function ActiveSessionsSection({ sessions }: { sessions: PublicSessionView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const otherCount = sessions.filter((session) => !session.isCurrent).length;

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Active sessions"
        description="Devices signed into your account. Revoking a session ends it immediately."
      />
      {error ? <p className="px-4 pt-2 text-sm text-danger">{error}</p> : null}
      {sessions.length === 0 ? (
        <EmptyState title="No active sessions." description="Sign in again to create a session." />
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{summarizeUserAgent(session.userAgent)}</p>
                  {session.isCurrent ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      Current
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted">
                  IP: {session.ipAddress?.trim() || "Unknown"}
                </p>
                <p className="text-xs text-muted">
                  Last active: {formatDateTime(session.updatedAt)} · Expires:{" "}
                  {formatDateTime(session.expiresAt)}
                </p>
              </div>
              {!session.isCurrent ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 text-xs"
                  disabled={pending}
                  onClick={() => run(() => revokeSessionAction(session.id))}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t border-border px-4 py-4 sm:flex-row sm:flex-wrap">
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" disabled={pending}>
            Sign out this device
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || otherCount === 0}
          onClick={() => run(() => revokeOtherSessionsAction())}
        >
          Sign out other sessions
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-danger"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await revokeAllSessionsAction();
              if (result && !result.ok) {
                setError(result.message);
              }
            });
          }}
        >
          Sign out all sessions
        </Button>
      </div>
    </Card>
  );
}
