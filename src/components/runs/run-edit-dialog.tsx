"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { updateRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { RAID_DIFFICULTIES, type RaidDifficulty } from "@/models/enums";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunEditDialog({
  run,
  capabilities,
  editor,
  onClose,
}: {
  run: RunDetailView["run"];
  capabilities: RunDetailView["capabilities"];
  editor: RunDetailView["editor"];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(run.title);
  const [raidId, setRaidId] = useState(run.raidId);
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(run.difficulty);
  const [scheduledLocal, setScheduledLocal] = useState(toDatetimeLocalValue(run.scheduledStartAt));
  const [raidLeadId, setRaidLeadId] = useState(run.raidLeadId);
  const [notes, setNotes] = useState(run.notes ?? "");
  const [desiredTankCount, setDesiredTankCount] = useState(run.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(run.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(run.desiredDpsCount);

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

      const result = await updateRunAction({
        runId: run.id,
        title,
        raidId,
        difficulty,
        scheduledStartAt,
        raidLeadId: capabilities.canReassignRaidLead ? raidLeadId : undefined,
        notes: notes.trim() || null,
        desiredTankCount,
        desiredHealerCount,
        desiredDpsCount,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  if (!editor) {
    return null;
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
            ? "Raid and difficulty can still be changed because no signup history exists."
            : "Raid and difficulty are locked after signup history exists."}
        </p>
      </div>
      <form className="space-y-3 px-4 py-4" onSubmit={submit}>
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!capabilities.canEditPlanning}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Raid</span>
          <select
            aria-label="Raid"
            value={raidId}
            disabled={!capabilities.canEditIdentity}
            title={!capabilities.canEditIdentity ? "Raid cannot change after signup history exists." : undefined}
            onChange={(event) => setRaidId(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {editor.raids.map((raid) => (
              <option key={raid.id} value={raid.id}>
                {raid.name} · {raid.season}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Difficulty</span>
          <select
            aria-label="Difficulty"
            value={difficulty}
            disabled={!capabilities.canEditIdentity}
            title={!capabilities.canEditIdentity ? "Difficulty cannot change after signup history exists." : undefined}
            onChange={(event) => setDifficulty(event.target.value as RaidDifficulty)}
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
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
          <Button type="button" variant="secondary" onClick={close}>
            Close
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
