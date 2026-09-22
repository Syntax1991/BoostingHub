"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateNotificationSettingsAction } from "@/controllers/settings.actions";
import type { NotificationDmPreferences } from "@/services/settings.service";

const EVENT_TOGGLES: Array<{
  key: Exclude<keyof NotificationDmPreferences, "discordDmEnabled">;
  label: string;
  description: string;
}> = [
  {
    key: "dmRosterSelectedEnabled",
    label: "Roster Pick DMs",
    description: "Receive a Discord DM when you are newly selected into a published roster.",
  },
  {
    key: "dmRaidInviteEnabled",
    label: "Raid Invite DMs",
    description: "Receive the Raid Invite Discord DM when the run starts.",
  },
  {
    key: "dmRunCancelledEnabled",
    label: "Run Cancelled DMs",
    description: "Receive a Discord DM when a run you signed up for is cancelled.",
  },
  {
    key: "dmRunRescheduledEnabled",
    label: "Run Rescheduled DMs",
    description: "Receive a Discord DM when a run you signed up for changes schedule.",
  },
  {
    key: "dmRosterRemovedEnabled",
    label: "Roster Removed DMs",
    description: "Receive a Discord DM when you are removed from a published roster.",
  },
];

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

  const masterOff = !prefs.discordDmEnabled;

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
            <span className="font-medium">Discord DMs</span>
            <span className="mt-0.5 block text-xs text-muted">
              Allow BoostingHub to also send enabled notifications to you by Discord DM.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
            checked={prefs.discordDmEnabled}
            disabled={pending}
            onChange={(event) => setPreference("discordDmEnabled", event.target.checked)}
          />
        </label>

        {masterOff ? (
          <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted">
            Discord DMs are temporarily disabled. Your individual event preferences are preserved and
            will apply again when you turn Discord DMs back on.
          </p>
        ) : null}

        <div className={masterOff ? "space-y-4 opacity-50" : "space-y-4"}>
          {EVENT_TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flex items-start justify-between gap-4">
              <span>
                <span className="font-medium">{toggle.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{toggle.description}</span>
              </span>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
                checked={prefs[toggle.key]}
                disabled={pending || masterOff}
                onChange={(event) => setPreference(toggle.key, event.target.checked)}
              />
            </label>
          ))}
        </div>

        <p className="text-xs text-muted">In-app BoostingHub notifications remain enabled.</p>
      </div>
    </Card>
  );
}
