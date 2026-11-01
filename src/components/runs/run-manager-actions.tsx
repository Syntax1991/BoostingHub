"use client";

import { useState, useTransition } from "react";
import {
  closeRunSignupsAction,
  openRunAction,
  reopenRunSignupsAction,
} from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { RunCancelDialog } from "@/components/runs/run-cancel-dialog";
import { RunReactivateDialog } from "@/components/runs/run-reactivate-dialog";
import { RunCompleteDialog } from "@/components/runs/run-complete-dialog";
import { RunEditDialog } from "@/components/runs/run-edit-dialog";
import { RosterBuilderTrigger } from "@/components/manage/roster-builder-dialog";
import { RunStartDialog } from "@/components/runs/run-start-dialog";
import type { RunDetailView } from "@/services/run-detail.service";
import type { FinalSetupInput } from "@/lib/run-start-message";

export function RunManagerActions({
  run,
  capabilities,
  editor,
  unmarkedCount = 0,
  finalSetupPreview,
  rosterHasUnpublishedChanges = false,
  preflight = null,
  /** `admin` = Run administration block (no Auto Build; Add Booster — registered and External — lives in the roster builder). */
  surface = "all",
}: {
  run: RunDetailView["run"];
  capabilities: RunDetailView["capabilities"];
  editor: RunDetailView["editor"];
  unmarkedCount?: number;
  finalSetupPreview?: FinalSetupInput | null;
  /** Saved roster draft differs from the published roster — Start will be refused server-side. */
  rosterHasUnpublishedChanges?: boolean;
  /** Advisory Start checklist shown in the Start dialog. */
  preflight?: RunDetailView["preflight"];
  surface?: "all" | "admin";
}) {
  const showRosterTools = surface !== "admin";
  // The Roster tab admin bar is a compact secondary row above the roster.
  const buttonSize = surface === "admin" ? "sm" : "md";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const runId = run.id;

  function runAction(action: () => Promise<{ ok: boolean; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  const hasActions =
    showRosterTools ||
    capabilities.canEdit ||
    capabilities.canOpen ||
    capabilities.canCloseSignups ||
    capabilities.canReopenSignups ||
    capabilities.canCancel ||
    capabilities.canReactivate ||
    capabilities.canStart ||
    capabilities.canComplete;

  if (!hasActions) {
    return null;
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {showRosterTools ? <RosterBuilderTrigger runId={runId} /> : null}
        {capabilities.canEdit ? (
          <Button type="button" size={buttonSize} variant="secondary" onClick={() => setEditOpen(true)}>
            Edit Run
          </Button>
        ) : null}
        {capabilities.canOpen ? (
          <Button
            type="button"
            size={buttonSize}
            disabled={pending}
            onClick={() => runAction(() => openRunAction({ runId }))}
          >
            Open Run
          </Button>
        ) : null}
        {capabilities.canCloseSignups ? (
          <Button
            type="button"
            size={buttonSize}
            variant="secondary"
            disabled={pending}
            onClick={() => runAction(() => closeRunSignupsAction({ runId }))}
          >
            Close Signups
          </Button>
        ) : null}
        {capabilities.canReopenSignups ? (
          <Button
            type="button"
            size={buttonSize}
            variant="secondary"
            disabled={pending}
            onClick={() => runAction(() => reopenRunSignupsAction({ runId }))}
          >
            Reopen Signups
          </Button>
        ) : null}
        {capabilities.canCancel ? (
          <Button type="button" size={buttonSize} variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel Run
          </Button>
        ) : null}
        {capabilities.canReactivate ? (
          <Button type="button" size={buttonSize} onClick={() => setReactivateOpen(true)}>
            Reactivate Run
          </Button>
        ) : null}
        {capabilities.canStart ? (
          <Button type="button" size={buttonSize} onClick={() => setStartOpen(true)}>
            Start Run
          </Button>
        ) : null}
        {capabilities.canComplete ? (
          <Button type="button" size={buttonSize} onClick={() => setCompleteOpen(true)}>
            Complete Run{unmarkedCount > 0 ? ` (${unmarkedCount} unmarked)` : ""}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-sm text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
      {editOpen && editor ? (
        <RunEditDialog run={run} capabilities={capabilities} editor={editor} onClose={() => setEditOpen(false)} />
      ) : null}
      {cancelOpen ? <RunCancelDialog runId={runId} onClose={() => setCancelOpen(false)} /> : null}
      {reactivateOpen ? (
        <RunReactivateDialog
          runId={runId}
          cancelledFromStatus={run.cancelledFromStatus ?? null}
          onClose={() => setReactivateOpen(false)}
        />
      ) : null}
      {startOpen ? (
        <RunStartDialog
          runId={runId}
          finalSetup={finalSetupPreview}
          rosterHasUnpublishedChanges={rosterHasUnpublishedChanges}
          preflight={preflight}
          onClose={() => setStartOpen(false)}
        />
      ) : null}
      {completeOpen ? (
        <RunCompleteDialog runId={runId} unmarkedCount={unmarkedCount} onClose={() => setCompleteOpen(false)} />
      ) : null}
    </div>
  );
}
