"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { updateRunChannelSettingsAction } from "@/controllers/settings.actions";
import { DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH } from "@/lib/discord-channel-name";

export function RunChannelSettingsCard({
  discordRunChannelNickname,
}: {
  discordRunChannelNickname: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(discordRunChannelNickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateRunChannelSettingsAction({
        discordRunChannelNickname: value.trim() ? value : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Run Channels"
        description="Optional short name used only in BoostingHub Discord Run channel names."
      />
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? <p className="text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-xs text-muted">Preferences saved.</p> : null}
        <label className="block">
          <span className="font-medium">Run channel nickname</span>
          <span className="mt-0.5 block text-xs text-muted">
            Example: mon-2200-hc-vip-9of9-syntax. Leave empty to use your BoostingHub name.
          </span>
          <input
            type="text"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={value}
            maxLength={DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH}
            disabled={pending}
            placeholder="Syntax"
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
              setError(null);
            }}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          disabled={pending}
          onClick={onSave}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}
