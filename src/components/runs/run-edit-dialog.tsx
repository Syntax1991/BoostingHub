"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { updateRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { projectRunContentCoverage } from "@/lib/run-content-display";
import { selectionCoveragePreview, type ProductSelection } from "@/lib/product-selection";
import { KEEP_CURRENT_CONTENTS, ProductContentPicker } from "@/components/runs/product-content-picker";
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

  // Runs whose contents match no active Product keep them unless a product is chosen.
  const [selection, setSelection] = useState<ProductSelection>(
    editor.currentSelection ?? { productId: KEEP_CURRENT_CONTENTS, contentBossCounts: {} },
  );
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(run.difficulty);
  const [lootType, setLootType] = useState<RunLootType>(run.lootType);
  const [scheduledLocal, setScheduledLocal] = useState(toDatetimeLocalValue(run.scheduledStartAt));
  const [raidLeadId, setRaidLeadId] = useState(run.raidLeadId);
  const [notes, setNotes] = useState(run.notes ?? "");
  const [desiredTankCount, setDesiredTankCount] = useState(run.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(run.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(run.desiredDpsCount);
  const [desiredLootbuddyCount, setDesiredLootbuddyCount] = useState(run.desiredLootbuddyCount ?? 0);
  const [discordRolePing, setDiscordRolePing] = useState(run.discordRolePing);

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

  function selectDifficulty(nextDifficulty: RaidDifficulty) {
    setDifficulty(nextDifficulty);
    if (!isLootTypeAllowedForDifficulty(nextDifficulty, lootType)) {
      setLootType("UNSAVED");
    }
  }

  const generatedTitle = useMemo(() => {
    try {
      const scheduledStartAt = fromDatetimeLocalValue(scheduledLocal);
      const selected = editor.products.find((product) => product.id === selection.productId);
      const titleCoverage = selected
        ? selectionCoveragePreview(selected, selection.contentBossCounts)
        : projectRunContentCoverage(editor.contents).titleCoverage;
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
  }, [scheduledLocal, difficulty, lootType, editor.contents, editor.products, selection, raidLeadName]);

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
        desiredLootbuddyCount,
        discordRolePing,
      };

      // No product (or a locked identity) → the server keeps the current contents.
      const result = await updateRunAction(
        selection.productId && capabilities.canEditIdentity
          ? { ...base, productId: selection.productId, contentBossCounts: selection.contentBossCounts }
          : base,
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
          Run details can be changed until the run starts.
        </p>
      </div>
      <form className="space-y-3 px-4 py-4" onSubmit={submit}>
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <ProductContentPicker
          products={editor.products}
          value={selection}
          onChange={setSelection}
          ariaPrefix="Run"
          disabled={!capabilities.canEditIdentity}
          keepCurrentLabel={editor.currentSelection ? undefined : `Keep current contents (${editor.contentSummary})`}
        />
        {!capabilities.canEditIdentity ? (
          <p className="text-xs text-muted">The run has started — content and difficulty are locked.</p>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Difficulty</span>
          <select
            aria-label="Difficulty"
            value={difficulty}
            disabled={!capabilities.canEditIdentity}
            title={!capabilities.canEditIdentity ? "The run has started — details are locked." : undefined}
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
          <span className="mb-1 block text-muted">Run type</span>
          <select
            aria-label="Run type"
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Lootbuddies</span>
            <input
              type="number"
              min={0}
              max={40}
              value={desiredLootbuddyCount}
              disabled={!capabilities.canEditPlanning}
              onChange={(event) => setDesiredLootbuddyCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Desired lootbuddies"
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={discordRolePing}
            disabled={!capabilities.canEditPlanning}
            onChange={(event) => setDiscordRolePing(event.target.checked)}
            className="mt-1 disabled:cursor-not-allowed"
            aria-label="Ping Tank, Healer, and DPS Discord roles"
          />
          <span>
            <span className="block">Ping Discord roles (@Tank @Healer @DPS)</span>
            <span className="mt-0.5 block text-xs text-muted">
              Applies when the Run channel is first created. Changing this later does not re-ping.
            </span>
          </span>
        </label>
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
