"use client";

import { useState } from "react";
import { updateRaidAction } from "@/controllers/raid-catalog.actions";
import {
  CheckboxField,
  RaidCatalogDialog,
  Field,
  fieldInputClass,
} from "@/components/manage/raid-catalog/raid-catalog-dialog";
import { SeasonSelector } from "@/components/manage/raid-catalog/season-selector";
import { raidShortName } from "@/lib/raid-catalog";

export type RaidFormValues = {
  raidId: string;
  name: string;
  shortName: string | null;
  season: string;
  sortOrder: number;
  trackLockouts: boolean;
  availableForRuns: boolean;
  blizzardInstanceId: number | null;
};

const text = (value: number | null) => (value == null ? "" : String(value));

/**
 * Edit a Raid's BoostingHub-owned metadata (season, order, lockout tracking, run
 * availability). Raids are created by the Blizzard import; for a Blizzard-linked
 * raid the name and instance id are Blizzard-owned and not editable here.
 */
export function RaidFormDialog({
  raid,
  seasons,
}: {
  raid: RaidFormValues;
  seasons: readonly string[];
}) {
  const initial = raid;
  const blizzardLinked = initial.blizzardInstanceId != null;
  const [name, setName] = useState(initial.name);
  const [shortName, setShortName] = useState(initial.shortName ?? "");
  const [season, setSeason] = useState(initial.season);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));
  const [trackLockouts, setTrackLockouts] = useState(initial.trackLockouts);
  const [availableForRuns, setAvailableForRuns] = useState(initial.availableForRuns);
  const [blizzardInstanceId, setBlizzardInstanceId] = useState(text(initial.blizzardInstanceId));
  const [showAdvanced, setShowAdvanced] = useState(false);

  function reset() {
    setName(initial.name);
    setShortName(initial.shortName ?? "");
    setSeason(initial.season);
    setSortOrder(String(initial.sortOrder));
    setTrackLockouts(initial.trackLockouts);
    setAvailableForRuns(initial.availableForRuns);
    setBlizzardInstanceId(text(initial.blizzardInstanceId));
    setShowAdvanced(false);
  }

  const fields = { name, shortName, season, sortOrder, trackLockouts, blizzardInstanceId };

  return (
    <RaidCatalogDialog
      triggerLabel="Edit raid"
      title={`Edit raid · ${initial.name}`}
      description={
        blizzardLinked
          ? "Season, order, lockout tracking and run availability are BoostingHub settings. Name and bosses come from Blizzard (Refresh from Blizzard)."
          : "Names, season, order and lockout tracking are safe to change. Warcraft Logs ids are detected automatically."
      }
      submitLabel="Save raid"
      onOpen={reset}
      onSubmit={() => updateRaidAction({ ...fields, raidId: initial.raidId, availableForRuns })}
    >
      {blizzardLinked ? null : (
        <Field label="Name">
          <input
            className={fieldInputClass}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      )}
      <Field
        label="Short name"
        hint={`Compact label for Discord signup titles, e.g. "Venom & Tide". Empty uses "${raidShortName({ name: initial.name })}".`}
      >
        <input
          className={fieldInputClass}
          value={shortName}
          maxLength={24}
          onChange={(e) => setShortName(e.target.value)}
        />
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
      <CheckboxField
        label="Available for new Runs"
        hint="Offered as a raid choice when creating or editing a Run. Off hides it there (shown as Historical in the Run editor); Bundle content such as Tide stays usable and existing Runs are unchanged."
        checked={availableForRuns}
        onChange={setAvailableForRuns}
      />
      {blizzardLinked ? null : (
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
                hint="Prefer Import raid with the journal instance id: it links this raid by name and syncs its bosses."
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
      )}
    </RaidCatalogDialog>
  );
}
