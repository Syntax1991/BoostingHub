"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateRegionalSettingsAction } from "@/controllers/settings.actions";

export function RegionalSettingsCard({
  timeZone,
  timeZones,
}: {
  timeZone: string;
  timeZones: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(timeZone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onChange(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateRegionalSettingsAction({ timeZone: next });
      if (!result.ok) {
        setError(result.message);
        setValue(previous);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Regional"
        description="Personal time display. Community run titles and Discord channel weeks stay on Europe/Berlin."
      />
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-xs text-muted">Preferences saved.</p> : null}
        <label className="block">
          <span className="font-medium">Timezone</span>
          <span className="mt-0.5 block text-xs text-muted">
            Used for your personal schedule displays and notification timestamps.
          </span>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={value}
            disabled={pending}
            onChange={(event) => onChange(event.target.value)}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}
