"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateNotificationSettingsAction } from "@/controllers/settings.actions";
import type { NotificationDmPreferences } from "@/services/settings.service";

const EVENT_TOGGLES: Array<{
  key: Exclude<keyof NotificationDmPreferences, "discordDmEnabled" | "quietHours">;
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

const DEFAULT_QUIET_SUGGESTION = { start: "22:00", end: "07:00" } as const;

export function NotificationSettingsCard({
  preferences,
  timeZone,
}: {
  preferences: NotificationDmPreferences;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(preferences);
  const [quietDraft, setQuietDraft] = useState(preferences.quietHours);
  const [quietDirty, setQuietDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function fullPayload(overrides: Partial<NotificationDmPreferences> = {}): NotificationDmPreferences {
    return {
      ...prefs,
      quietHours: quietDraft,
      ...overrides,
    };
  }

  function persist(next: NotificationDmPreferences, onRollback?: () => void) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateNotificationSettingsAction(next);
      if (!result.ok) {
        setError(result.message);
        onRollback?.();
        return;
      }
      setPrefs(next);
      setQuietDraft(next.quietHours);
      setQuietDirty(false);
      setSaved(true);
      router.refresh();
    });
  }

  function setPreference(
    key: Exclude<keyof NotificationDmPreferences, "quietHours">,
    value: boolean,
  ) {
    const previous = prefs;
    const next = fullPayload({ [key]: value });
    setPrefs(next);
    persist(next, () => setPrefs(previous));
  }

  function onQuietEnabledChange(enabled: boolean) {
    let nextQuiet = { ...quietDraft, enabled };
    if (enabled && !nextQuiet.start && !nextQuiet.end) {
      nextQuiet = {
        ...nextQuiet,
        start: DEFAULT_QUIET_SUGGESTION.start,
        end: DEFAULT_QUIET_SUGGESTION.end,
      };
    }
    setQuietDraft(nextQuiet);
    setError(null);
    setSaved(false);

    if (!enabled) {
      const next = fullPayload({ quietHours: nextQuiet });
      setPrefs(next);
      persist(next);
      return;
    }

    setQuietDirty(true);
  }

  function onQuietTimeChange(field: "start" | "end", value: string) {
    setQuietDraft((current) => ({ ...current, [field]: value }));
    setQuietDirty(true);
    setError(null);
    setSaved(false);
  }

  function saveQuietHours() {
    const next = fullPayload({ quietHours: quietDraft });
    setPrefs(next);
    persist(next);
  }

  const masterOff = !prefs.discordDmEnabled;
  const quietEnabled = quietDraft.enabled;

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="Choose which BoostingHub events should also be sent to you by Discord DM."
      />
      <div className="space-y-4 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error && !quietDirty ? (
          <p className="text-xs text-muted">Preferences saved.</p>
        ) : null}

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

        <div className="space-y-3 border-t border-border pt-4">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="font-medium">Quiet Hours</span>
              <span className="mt-0.5 block text-xs text-muted">
                Pause optional Discord DMs during these hours. In-app notifications remain immediate.
              </span>
              <span className="mt-1 block text-xs text-muted">Uses your timezone: {timeZone}</span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
              checked={quietEnabled}
              disabled={pending}
              onChange={(event) => onQuietEnabledChange(event.target.checked)}
            />
          </label>

          <div className={quietEnabled ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 opacity-60"}>
            <label className="block">
              <span className="font-medium">From</span>
              <input
                type="time"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={quietDraft.start ?? ""}
                disabled={pending || !quietEnabled}
                onChange={(event) => onQuietTimeChange("start", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="font-medium">Until</span>
              <input
                type="time"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={quietDraft.end ?? ""}
                disabled={pending || !quietEnabled}
                onChange={(event) => onQuietTimeChange("end", event.target.value)}
              />
            </label>
          </div>

          {quietDirty ? (
            <button
              type="button"
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={pending || !quietEnabled}
              onClick={saveQuietHours}
            >
              Save Quiet Hours
            </button>
          ) : null}
        </div>

        <p className="text-xs text-muted">In-app BoostingHub notifications remain enabled.</p>
      </div>
    </Card>
  );
}
