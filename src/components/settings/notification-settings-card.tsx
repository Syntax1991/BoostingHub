"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateNotificationSettingsAction } from "@/controllers/settings.actions";
import type { NotificationDmPreferences } from "@/services/settings.service";

export function NotificationSettingsCard({
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
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateNotificationSettingsAction(next);
      if (!result.ok) {
        setError(result.message);
        setPrefs(previous);
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
        description="Choose which BoostingHub events should also be sent to you by Discord DM."
      />
      <div className="space-y-4 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-xs text-muted">Preferences saved.</p> : null}
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="font-medium">Roster Pick DMs</span>
            <span className="mt-0.5 block text-xs text-muted">
              Receive a Discord DM when you are newly selected into a published roster.
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
              Receive the Raid Invite Discord DM when the run starts.
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
        <p className="text-xs text-muted">In-app BoostingHub notifications remain enabled.</p>
      </div>
    </Card>
  );
}
