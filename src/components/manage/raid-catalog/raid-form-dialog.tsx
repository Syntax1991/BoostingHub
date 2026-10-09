"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRaidAction, updateRaidAction } from "@/controllers/raid-catalog.actions";
import { CheckboxField, RaidCatalogDialog, Field, fieldInputClass } from "@/components/manage/raid-catalog/raid-catalog-dialog";
import { SeasonSelector } from "@/components/manage/raid-catalog/season-selector";

export type RaidFormValues = {
  raidId?: string;
  name: string;
  season: string;
  sortOrder: number;
  trackLockouts: boolean;
  availableForRuns: boolean;
  blizzardInstanceId: number | null;
};

const EMPTY: RaidFormValues = {
  name: "",
  season: "",
  sortOrder: 0,
  trackLockouts: false,
  availableForRuns: false,
  blizzardInstanceId: null,
};

const text = (value: number | null) => (value == null ? "" : String(value));

/** Create a Raid (no encounters, no Product) or edit a Raid's identity-preserving metadata. */
export function RaidFormDialog({ raid, seasons }: { raid?: RaidFormValues; seasons: readonly string[] }) {
  const router = useRouter();
  const editing = Boolean(raid?.raidId);
  const initial = raid ?? EMPTY;
  const [name, setName] = useState(initial.name);
  const [season, setSeason] = useState(initial.season);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));
  const [trackLockouts, setTrackLockouts] = useState(initial.trackLockouts);
  const [availableForRuns, setAvailableForRuns] = useState(initial.availableForRuns);
  const [blizzardInstanceId, setBlizzardInstanceId] = useState(text(initial.blizzardInstanceId));
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial.blizzardInstanceId));

  function reset() {
    setName(initial.name);
    setSeason(initial.season);
    setSortOrder(String(initial.sortOrder));
    setTrackLockouts(initial.trackLockouts);
    setAvailableForRuns(initial.availableForRuns);
    setBlizzardInstanceId(text(initial.blizzardInstanceId));
    setShowAdvanced(Boolean(initial.blizzardInstanceId));
  }

  const fields = { name, season, sortOrder, trackLockouts, blizzardInstanceId };

  return (
    <RaidCatalogDialog
      triggerLabel={editing ? "Edit raid" : "New raid"}
      triggerVariant={editing ? "secondary" : "primary"}
      triggerClassName={editing ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm"}
      title={editing ? `Edit raid · ${initial.name}` : "New raid"}
      description={
        editing
          ? "Names, season, order and lockout tracking are safe to change. Warcraft Logs ids are detected automatically."
          : "A new raid starts without encounters, is not tracked for lockouts unless you enable it, and is not offered for new Runs. No Product is created."
      }
      submitLabel={editing ? "Save raid" : "Create raid"}
      onOpen={reset}
      onSubmit={() =>
        editing
          ? updateRaidAction({ ...fields, raidId: initial.raidId, availableForRuns })
          : createRaidAction(fields)
      }
      onSuccess={(result) => {
        const created = result as { raidId?: string };
        if (!editing && created.raidId) router.push(`/manage/raid-catalog/raids/${created.raidId}`);
      }}
    >
      <Field label="Name">
        <input className={fieldInputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </Field>
      <SeasonSelector seasons={seasons} value={season} onChange={setSeason} />
      <Field label="Order" hint="Lower numbers come first (lockout views, lists).">
        <input
          className={fieldInputClass}
          type="number"
          min={0}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </Field>
      <CheckboxField
        label="Track Blizzard lockouts"
        hint="Character syncs derive this raid's lockouts. Turning it off deletes nothing now; past-reset lockouts are kept, and the current reset's rows for this raid are cleared at each Character's next sync (Blizzard re-derives them if you turn it back on)."
        checked={trackLockouts}
        onChange={setTrackLockouts}
      />
      {editing ? (
        <CheckboxField
          label="Available for new Runs"
          hint="Offered as a raid choice when creating or editing a Run. Off hides it there (shown as Historical in the Run editor); Bundle content such as Tide stays usable and existing Runs are unchanged."
          checked={availableForRuns}
          onChange={setAvailableForRuns}
        />
      ) : null}
      <div>
        <button
          type="button"
          className="text-xs text-muted hover:text-foreground"
          onClick={() => setShowAdvanced((open) => !open)}
        >
          {showAdvanced ? "Hide advanced" : "Advanced / Integrations"}
        </button>
        {showAdvanced ? (
          <div className="mt-2">
            <Field
              label="Blizzard instance id"
              hint="Journal instance id for lockout sync. Leave empty if unknown — Warcraft Logs ids are detected automatically."
            >
              <input
                className={fieldInputClass}
                inputMode="numeric"
                placeholder="e.g. 1320"
                value={blizzardInstanceId}
                onChange={(e) => setBlizzardInstanceId(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </RaidCatalogDialog>
  );
}
