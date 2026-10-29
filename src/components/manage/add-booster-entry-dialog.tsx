"use client";

import { useState } from "react";
import { AddBoosterDialog } from "@/components/manage/add-booster-dialog";
import { ExternalBoostersDialog } from "@/components/runs/external-boosters-dialog";
import type { ExternalBooster } from "@/lib/external-booster";

export type AddBoosterMode = "registered" | "external";

/**
 * The Roster's one Add Booster entry: a registered Manawyrm Hub player
 * (normal Booster signup, see AddBoosterDialog) or a Booster / Lootbuddy
 * without an account (External Boosters). Both keep their own dialog, save
 * path and rules; this only switches between them.
 */
export function AddBoosterEntryDialog({
  runId,
  rosterVersion,
  externalBoosters,
  initialMode = "registered",
  onClose,
  onAdded,
}: {
  runId: string;
  rosterVersion: number;
  externalBoosters: ExternalBooster[];
  initialMode?: AddBoosterMode;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<AddBoosterMode>(initialMode);
  const modeSwitch = <AddBoosterModeSwitch mode={mode} externalCount={externalBoosters.length} onChange={setMode} />;
  return mode === "registered" ? (
    <AddBoosterDialog
      key="registered"
      runId={runId}
      rosterVersion={rosterVersion}
      onClose={onClose}
      onAdded={onAdded}
      modeSwitch={modeSwitch}
    />
  ) : (
    <ExternalBoostersDialog
      key="external"
      runId={runId}
      rosterVersion={rosterVersion}
      boosters={externalBoosters}
      onClose={onClose}
      modeSwitch={modeSwitch}
    />
  );
}

export function AddBoosterModeSwitch({
  mode,
  externalCount,
  onChange,
}: {
  mode: AddBoosterMode;
  externalCount: number;
  onChange: (mode: AddBoosterMode) => void;
}) {
  const options: Array<{ value: AddBoosterMode; label: string }> = [
    { value: "registered", label: "Registered player" },
    { value: "external", label: externalCount > 0 ? `External (${externalCount})` : "External" },
  ];
  return (
    <div role="tablist" aria-label="Booster type" className="mb-2.5 inline-flex rounded-md border border-border p-0.5 text-xs">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={mode === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 rounded px-2.5 font-medium ${
            mode === option.value ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
