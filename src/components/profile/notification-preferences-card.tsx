"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateDmPreferencesAction } from "@/controllers/notification.actions";
import type { NotificationDmPreferences } from "@/services/notification.service";

export function NotificationPreferencesCard({
  preferences,
}: {
  preferences: NotificationDmPreferences;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setPreference(key: keyof NotificationDmPreferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDmPreferencesAction(next);
      if (!result.ok) {
        setError(result.message);
        setPrefs(preferences);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="In-app notifications stay on. These toggles only control Discord DMs."
      />
      <div className="space-y-4 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-xs text-muted">Preferences saved.</p> : null}
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="font-medium">Roster Pick DMs</span>
            <span className="mt-0.5 block text-xs text-muted">
              Discord DM when you are newly selected on a published roster.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
            checked={prefs.dmRosterSelectedEnabled}
            disabled={pending}
            onChange={(event) => setPreference("dmRosterSelectedEnabled", event.target.checked)}
          />
        </label>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="font-medium">Raid Invite DMs</span>
            <span className="mt-0.5 block text-xs text-muted">
              Discord DM when a run you are selected for starts.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
            checked={prefs.dmRaidInviteEnabled}
            disabled={pending}
            onChange={(event) => setPreference("dmRaidInviteEnabled", event.target.checked)}
          />
        </label>
        <p className="text-xs text-muted">In-app bell notifications cannot be disabled.</p>
      </div>
    </Card>
  );
}
