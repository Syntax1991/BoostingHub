"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openRunAction, restoreRunAction } from "@/controllers/run.actions";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { RunArchiveDialog } from "@/components/runs/run-archive-dialog";
import { RunCancelDialog } from "@/components/runs/run-cancel-dialog";
import { RunCompleteDialog } from "@/components/runs/run-complete-dialog";
import { RunDeleteDialog } from "@/components/runs/run-delete-dialog";
import { RunStartDialog } from "@/components/runs/run-start-dialog";
import { runDetailPath, runDetailTabForManageAction } from "@/lib/run-routes";
import type { RunLifecycleCapabilities } from "@/services/run-state";
import type { RunStatus } from "@/models/enums";

type QuickActionRun = {
  id: string;
  title: string;
  status: RunStatus;
  archivedAt: string | null;
  actionLabel: string;
  capabilities: RunLifecycleCapabilities;
};

const LINK_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised";

type DialogKind = "start" | "complete" | "cancel" | "archive" | "delete" | null;

/**
 * Manage Runs' operational cell: one status-aware primary action plus a
 * compact overflow menu, never a row of every possible button. Every mutation
 * reuses the exact same Controller actions (and, where one already exists,
 * the exact same confirmation dialog) as the canonical Run detail page —
 * this component adds no new lifecycle rules of its own.
 */
export function RunQuickActions({ run }: { run: QuickActionRun }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isArchived = Boolean(run.archivedAt);
  const cap = run.capabilities;

  function runAction(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  let primary: React.ReactNode;
  if (isArchived) {
    primary = (
      <Button type="button" disabled={pending} onClick={() => runAction(() => restoreRunAction({ runId: run.id }))}>
        {pending ? "Restoring…" : "Restore"}
      </Button>
    );
  } else if (cap.canOpen) {
    primary = (
      <Button type="button" disabled={pending} onClick={() => runAction(() => openRunAction({ runId: run.id }))}>
        {pending ? "Opening…" : "Open Run"}
      </Button>
    );
  } else if (run.status === "OPEN" || run.status === "ROSTERING") {
    primary = (
      <Link href={runDetailPath(run.id, runDetailTabForManageAction(run.actionLabel))} className={LINK_BUTTON_CLASS}>
        {run.actionLabel}
      </Link>
    );
  } else if (cap.canStart) {
    primary = (
      <Button type="button" onClick={() => setDialog("start")}>
        Start Run
      </Button>
    );
  } else if (cap.canComplete) {
    primary = (
      <Button type="button" onClick={() => setDialog("complete")}>
        Complete Run
      </Button>
    );
  } else if (cap.canArchive) {
    primary = (
      <Button type="button" onClick={() => setDialog("archive")}>
        Archive
      </Button>
    );
  } else {
    primary = (
      <Link href={runDetailPath(run.id)} className={LINK_BUTTON_CLASS}>
        View Run
      </Link>
    );
  }

  // Cancel and Delete are deliberately mutually exclusive in this menu: a
  // Draft that's been abandoned is deleted, not cancelled — cancelling it
  // would just strand it as a dead CANCELLED row with nothing to archive
  // (Archive never applies to Draft). Once a Run has left Draft, only
  // Cancel makes sense, and only while the domain still allows it.
  const showCancel = !isArchived && run.status !== "DRAFT" && cap.canCancel;
  const showDelete = !isArchived && run.status === "DRAFT" && cap.canDelete;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {primary}
        <details
          name="manage-runs-actions"
          className="relative"
          open={menuOpen}
          onToggle={(event) => setMenuOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary
            aria-label={`More actions for ${run.title}`}
            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border text-muted hover:bg-surface-raised"
          >
            <span aria-hidden="true">⋯</span>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-border bg-surface py-1 text-sm shadow-lg">
            <Link
              href={runDetailPath(run.id)}
              className="block px-3 py-1.5 hover:bg-surface-raised"
              onClick={() => setMenuOpen(false)}
            >
              View Run
            </Link>
            {showCancel ? (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-danger hover:bg-surface-raised"
                onClick={() => {
                  setMenuOpen(false);
                  setDialog("cancel");
                }}
              >
                Cancel Run
              </button>
            ) : null}
            {showDelete ? (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-danger hover:bg-surface-raised"
                onClick={() => {
                  setMenuOpen(false);
                  setDialog("delete");
                }}
              >
                Delete Run
              </button>
            ) : null}
          </div>
        </details>
      </div>
      {error ? (
        <p role="alert" className="max-w-[12rem] text-xs text-danger">
          {error}
        </p>
      ) : null}
      {dialog === "start" ? <RunStartDialog runId={run.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "complete" ? (
        <RunCompleteDialog runId={run.id} unmarkedCount={0} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "cancel" ? <RunCancelDialog runId={run.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "archive" ? (
        <RunArchiveDialog runId={run.id} runTitle={run.title} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "delete" ? (
        <RunDeleteDialog runId={run.id} runTitle={run.title} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
