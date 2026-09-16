"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { updateRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import {
  projectRunContentCoverage,
  titleCoverageFromPreset,
  type RunContentPresetKey,
} from "@/lib/run-content-presets";
import { buildRunTitle } from "@/lib/run-title";
import { isLootTypeAllowedForDifficulty } from "@/services/run-state";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunEditDialog({
  run,
  capabilities,
  editor,
  onClose,
}: {
  run: RunDetailView["run"];
  capabilities: RunDetailView["capabilities"];
  editor: NonNullable<RunDetailView["editor"]>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isCustom = editor.contentPreset === "CUSTOM";
  const primaryContent = editor.contents[0];
  const identityLocked = isCustom && !capabilities.canEditIdentity;

  const [contentPreset, setContentPreset] = useState<RunContentPresetKey>(
    editor.contentPreset === "CUSTOM" ? "VENOMOUS_ABYSS" : editor.contentPreset,
  );
  const [venomousPlannedBossCount, setVenomousPlannedBossCount] = useState(editor.venomousPlannedBossCount);
  const [raidId, setRaidId] = useState(primaryContent?.raidId ?? editor.raids[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(run.difficulty);
  const [lootType, setLootType] = useState<RunLootType>(run.lootType);
  const [scheduledLocal, setScheduledLocal] = useState(toDatetimeLocalValue(run.scheduledStartAt));
  const [raidLeadId, setRaidLeadId] = useState(run.raidLeadId);
  const [notes, setNotes] = useState(run.notes ?? "");
  const [desiredTankCount, setDesiredTankCount] = useState(run.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(run.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(run.desiredDpsCount);
  const [plannedBossCount, setPlannedBossCount] = useState(primaryContent?.plannedBossCount ?? 1);

  const selectedRaid = editor.raids.find((raid) => raid.id === raidId);
  const totalBossCount = selectedRaid?.totalBossCount ?? primaryContent?.totalBossCount ?? 1;

  const raidLeadName =
    editor.raidLeads.find((lead) => lead.id === raidLeadId)?.name ?? run.raidLeadName;

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function selectRaid(nextRaidId: string) {
    setRaidId(nextRaidId);
    const raid = editor.raids.find((candidate) => candidate.id === nextRaidId);
    if (raid) {
      setPlannedBossCount(raid.totalBossCount);
    }
  }

  function selectDifficulty(nextDifficulty: RaidDifficulty) {
    setDifficulty(nextDifficulty);
    if (!isLootTypeAllowedForDifficulty(nextDifficulty, lootType)) {
      setLootType("UNSAVED");
    }
  }

  const generatedTitle = useMemo(() => {
    try {
      const scheduledStartAt = fromDatetimeLocalValue(scheduledLocal);
      const titleCoverage = isCustom
        ? identityLocked
          ? projectRunContentCoverage(editor.contents).titleCoverage
          : projectRunContentCoverage([
              {
                raidId,
                sortOrder: 1,
                plannedBossCount,
                totalBossCount,
              },
            ]).titleCoverage
        : titleCoverageFromPreset({
            preset: contentPreset,
            venomousPlannedBossCount,
            venomousTotalBossCount: editor.venomousBossMax,
          });
      return buildRunTitle({
        scheduledStartAt,
        difficulty,
        lootType,
        titleCoverage,
        raidLeadName,
      });
    } catch {
      return "—";
    }
  }, [
    scheduledLocal,
    difficulty,
    lootType,
    plannedBossCount,
    venomousPlannedBossCount,
    totalBossCount,
    editor.venomousBossMax,
    editor.contents,
    identityLocked,
    isCustom,
    contentPreset,
    raidLeadName,
    raidId,
  ]);

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      let scheduledStartAt: string;
      try {
        scheduledStartAt = fromDatetimeLocalValue(scheduledLocal);
      } catch {
        setError("Enter a valid scheduled start.");
        return;
      }

      const base = {
        runId: run.id,
        difficulty,
        lootType,
        scheduledStartAt,
        raidLeadId: capabilities.canReassignRaidLead ? raidLeadId : undefined,
        notes: notes.trim() || null,
        desiredTankCount,
        desiredHealerCount,
        desiredDpsCount,
      };

      const result = await updateRunAction(
        isCustom
          ? { ...base, raidId, plannedBossCount }
          : { ...base, contentPreset, venomousPlannedBossCount },
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Edit Run
        </h2>
        <p className="mt-1 text-xs text-muted">
          {capabilities.canEditIdentity
            ? "Product and difficulty can still be changed because no signup history exists."
            : "Product and difficulty are locked after signup history exists."}
        </p>
      </div>
      <form className="space-y-3 px-4 py-4" onSubmit={submit}>
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {isCustom ? (
          identityLocked ? (
            <div className="space-y-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
              <div>
                <span className="block text-xs text-muted">Product</span>
                <span className="font-medium">{run.productLabel}</span>
              </div>
              <div>
                <span className="block text-xs text-muted">Content</span>
                <span>{editor.contentSummary}</span>
              </div>
            </div>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Raid</span>
                <select
                  aria-label="Raid"
                  value={raidId}
                  onChange={(event) => selectRaid(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {editor.raids.map((raid) => (
                    <option key={raid.id} value={raid.id} disabled={!raid.availableForRuns}>
                      {raid.name} · {raid.season}
                      {raid.availableForRuns ? "" : " (Historical)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Planned bosses</span>
                <input
                  type="number"
                  min={1}
                  max={totalBossCount}
                  value={plannedBossCount}
                  onChange={(event) => setPlannedBossCount(Number(event.target.value))}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  aria-label="Planned bosses"
                />
                <span className="mt-1 block text-xs text-muted">Out of {totalBossCount} total bosses in this raid.</span>
              </label>
            </>
          )
        ) : (
          <>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Product</span>
              <select
                aria-label="Product"
                value={contentPreset}
                disabled={!capabilities.canEditIdentity}
                title={
                  !capabilities.canEditIdentity
                    ? "Product cannot change after signup history exists."
                    : undefined
                }
                onChange={(event) => setContentPreset(event.target.value as RunContentPresetKey)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editor.contentPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.displayName}
                  </option>
                ))}
              </select>
            </label>
            {contentPreset === "MIDNIGHT_S2_BUNDLE" ? (
              <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted">
                Nymrissa 1/1 (fixed)
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">The Venomous Abyss bosses</span>
              <input
                type="number"
                min={1}
                max={editor.venomousBossMax}
                value={venomousPlannedBossCount}
                disabled={!capabilities.canEditIdentity}
                onChange={(event) => setVenomousPlannedBossCount(Number(event.target.value))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Venomous planned bosses"
              />
              <span className="mt-1 block text-xs text-muted">
                Out of {editor.venomousBossMax} bosses in The Venomous Abyss.
              </span>
            </label>
          </>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Difficulty</span>
          <select
            aria-label="Difficulty"
            value={difficulty}
            disabled={!capabilities.canEditIdentity}
            title={!capabilities.canEditIdentity ? "Difficulty cannot change after signup history exists." : undefined}
            onChange={(event) => selectDifficulty(event.target.value as RaidDifficulty)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {RAID_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {DIFFICULTY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Loot Type</span>
          <select
            aria-label="Loot Type"
            value={lootType}
            disabled={!capabilities.canEditPlanning}
            onChange={(event) => setLootType(event.target.value as RunLootType)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {RUN_LOOT_TYPES.map((value) => (
              <option key={value} value={value} disabled={!isLootTypeAllowedForDifficulty(difficulty, value)}>
                {RUN_LOOT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
          {difficulty === "MYTHIC" ? (
            <span className="mt-1 block text-xs text-muted">Saved runs are not available for Mythic difficulty.</span>
          ) : null}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Scheduled start (Europe/Berlin)</span>
          <input
            type="datetime-local"
            value={scheduledLocal}
            disabled={!capabilities.canEditPlanning}
            onChange={(event) => setScheduledLocal(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Raid Lead</span>
          {editor.canAssignRaidLead ? (
            <select
              aria-label="Raid Lead"
              value={raidLeadId}
              onChange={(event) => setRaidLeadId(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {editor.raidLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                value={run.raidLeadName}
                disabled
                className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Raid Lead"
              />
              <span className="mt-1 block text-xs text-muted">Raid leads cannot reassign this run.</span>
            </>
          )}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Tanks</span>
            <input
              type="number"
              min={0}
              max={40}
              value={desiredTankCount}
              disabled={!capabilities.canEditPlanning}
              onChange={(event) => setDesiredTankCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Desired tanks"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Healers</span>
            <input
              type="number"
              min={0}
              max={40}
              value={desiredHealerCount}
              disabled={!capabilities.canEditPlanning}
              onChange={(event) => setDesiredHealerCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Desired healers"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">DPS</span>
            <input
              type="number"
              min={0}
              max={40}
              value={desiredDpsCount}
              disabled={!capabilities.canEditPlanning}
              onChange={(event) => setDesiredDpsCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Desired DPS"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Notes</span>
          <textarea
            value={notes}
            disabled={!capabilities.canEditPlanning}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-2 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="block text-muted">Generated title</span>
          <span className="font-medium">{generatedTitle}</span>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
