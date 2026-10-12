"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  attachScheduleRunAction,
  listScheduleAttachCandidatesAction,
} from "@/controllers/community-schedule.actions";
import type { RaidIdWindow } from "@/lib/community-schedule";
import type { AttachCandidate } from "@/services/community-schedule-occurrence.service";

/**
 * Schedule-side "Use existing Run": the occurrence is satisfied by an existing
 * Run, which keeps its own time / scope / roster (never rewritten).
 */
export function CommunityScheduleAttachRunDialog({
  scheduleSlotId,
  window,
}: {
  scheduleSlotId: string;
  window: RaidIdWindow;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [candidates, setCandidates] = useState<AttachCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    setSelected(null);
    setCandidates(null);
    dialogRef.current?.showModal();
    startTransition(async () => {
      const result = await listScheduleAttachCandidatesAction({ scheduleSlotId, window });
      if (!result.ok) {
        setError(result.message);
        setCandidates([]);
        return;
      }
      setCandidates(result.candidates);
      setSelected(result.candidates[0]?.runId ?? null);
    });
  }

  function attach() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await attachScheduleRunAction({ scheduleSlotId, runId: selected });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={open}
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b] disabled:opacity-60"
      >
        Use existing Run
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(34rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-left text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            Use an existing Run for this occurrence
          </h2>
          <p className="text-xs text-muted">
            The Run counts as this raid ID&apos;s occurrence, so no new Run is created for it. It keeps its own time,
            content, roster and signups; later occurrences still use the Run Setup.
          </p>
          {candidates === null ? (
            <p className="text-xs text-muted">Loading Runs…</p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-muted">No eligible Run in this raid ID (not archived, not cancelled, not started, not used elsewhere).</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {candidates.map((candidate) => (
                <li key={candidate.runId}>
                  <label className="flex cursor-pointer gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-raised">
                    <input
                      type="radio"
                      name={`${titleId}-run`}
                      checked={selected === candidate.runId}
                      onChange={() => setSelected(candidate.runId)}
                    />
                    <span className="space-y-1">
                      <span className="block font-medium text-foreground">{candidate.label}</span>
                      <span className="block text-muted">Raid Lead {candidate.raidLeadName}</span>
                      {candidate.warnings.map((warning) => (
                        <span key={warning.code} className="block text-warning">
                          {warning.message}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button disabled={pending || !selected} onClick={attach}>
              {pending && candidates !== null ? "Linking…" : "Use this Run"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
