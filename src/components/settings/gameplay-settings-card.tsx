"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateGameplaySettingsAction } from "@/controllers/settings.actions";

export function GameplaySettingsCard({
  defaultCharacterId,
  characters,
}: {
  defaultCharacterId: string | null;
  characters: Array<{ id: string; name: string; realm: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(defaultCharacterId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onChange(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateGameplaySettingsAction({
        defaultCharacterId: next.trim() ? next : null,
      });
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
        title="Gameplay"
        description="Defaults for signup workflows. Eligibility rules still apply on every run."
      />
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-xs text-muted">Preferences saved.</p> : null}
        <label className="block">
          <span className="font-medium">Default Character</span>
          <span className="mt-0.5 block text-xs text-muted">
            Preferred when signing up in web or Discord, if that character is eligible for the run.
          </span>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={value}
            disabled={pending}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">None</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}-{character.realm}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}
