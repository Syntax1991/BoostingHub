"use client";

import { useState, useTransition } from "react";
import {
  closeRunSignupsAction,
  openRunAction,
  reopenRunSignupsAction,
} from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { RunCancelDialog } from "@/components/runs/run-cancel-dialog";
import { RunCompleteDialog } from "@/components/runs/run-complete-dialog";
import { RunEditDialog } from "@/components/runs/run-edit-dialog";
import { RunStartDialog } from "@/components/runs/run-start-dialog";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunManagerActions({
  run,
  capabilities,
  editor,
  unmarkedCount = 0,
}: {
  run: RunDetailView["run"];
  capabilities: RunDetailView["capabilities"];
  editor: RunDetailView["editor"];
  unmarkedCount?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
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
    capabilities.canEdit ||
    capabilities.canOpen ||
    capabilities.canCloseSignups ||
    capabilities.canReopenSignups ||
    capabilities.canCancel ||
    capabilities.canStart ||
    capabilities.canComplete;

  if (!hasActions) {
    return null;
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {capabilities.canEdit ? (
          <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
            Edit Run
          </Button>
        ) : null}
        {capabilities.canOpen ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => runAction(() => openRunAction({ runId }))}
          >
            Open Run
          </Button>
        ) : null}
        {capabilities.canCloseSignups ? (
          <Button
            type="button"
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
            variant="secondary"
            disabled={pending}
            onClick={() => runAction(() => reopenRunSignupsAction({ runId }))}
          >
            Reopen Signups
          </Button>
        ) : null}
        {capabilities.canCancel ? (
          <Button type="button" variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel Run
          </Button>
        ) : null}
        {capabilities.canStart ? (
          <Button type="button" onClick={() => setStartOpen(true)}>
            Start Run
          </Button>
        ) : null}
        {capabilities.canComplete ? (
          <Button type="button" onClick={() => setCompleteOpen(true)}>
            Complete Run{unmarkedCount > 0 ? ` (${unmarkedCount} unmarked)` : ""}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-sm text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
      {editOpen ? (
        <RunEditDialog run={run} capabilities={capabilities} editor={editor} onClose={() => setEditOpen(false)} />
      ) : null}
      {cancelOpen ? <RunCancelDialog runId={runId} onClose={() => setCancelOpen(false)} /> : null}
      {startOpen ? <RunStartDialog runId={runId} onClose={() => setStartOpen(false)} /> : null}
      {completeOpen ? (
        <RunCompleteDialog runId={runId} unmarkedCount={unmarkedCount} onClose={() => setCompleteOpen(false)} />
      ) : null}
    </div>
  );
}
