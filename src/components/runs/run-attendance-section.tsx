"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { markAllPresentAction, setAttendanceAction } from "@/controllers/attendance.actions";
import { Button } from "@/components/ui/button";
import { AttendanceStatusBadge, ClassBadge, ParticipationBadge, RoleBadge } from "@/components/ui/badges";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/labels";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/models/enums";
import { ATTENDANCE_NOTE_MAX } from "@/services/run-state";
import { RunCompleteDialog } from "@/components/runs/run-complete-dialog";
import { RunStartDialog } from "@/components/runs/run-start-dialog";
import { AddStrikeFromAttendanceDialog } from "@/components/runs/add-strike-from-attendance-dialog";
import type { RunDetailView } from "@/services/run-detail.service";

const SUMMARY_ORDER: AttendanceStatus[] = [
  "PRESENT",
  "LATE",
  "LEFT_EARLY",
  "NO_SHOW",
  "EXCUSED",
  "STANDBY",
];

export function RunAttendanceSection({ data }: { data: RunDetailView }) {
  const manager = data.attendance.manager;
  const own = data.attendance.own;
  const canStart = data.capabilities.canStart;
  const canComplete = data.capabilities.canComplete;
  const [startOpen, setStartOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  if (manager) {
    if (!manager.started) {
      return (
        <Card>
          <CardHeader title="Attendance" description="Operational attendance starts when the run starts." />
          <div className="space-y-3 px-4 py-4 text-sm">
            <p>Run has not started yet.</p>
            {canStart ? (
              <Button type="button" onClick={() => setStartOpen(true)}>
                Start Run
              </Button>
            ) : null}
          </div>
          {startOpen ? <RunStartDialog runId={data.run.id} onClose={() => setStartOpen(false)} /> : null}
        </Card>
      );
    }

    return (
      <ManagerAttendancePanel
        runId={data.run.id}
        manager={manager}
        canComplete={canComplete}
        completeOpen={completeOpen}
        onCompleteOpen={() => setCompleteOpen(true)}
        onCompleteClose={() => setCompleteOpen(false)}
      />
    );
  }

  if (data.run.status === "PUBLISHED" || data.run.status === "OPEN" || data.run.status === "ROSTERING" || data.run.status === "DRAFT") {
    return (
      <Card>
        <CardHeader title="Attendance" />
        <p className="px-4 py-4 text-sm text-muted">Attendance will be available after the run starts.</p>
      </Card>
    );
  }

  if (own.length === 0) {
    return (
      <Card>
        <CardHeader title="Attendance" />
        <EmptyState title="No attendance for you" description="You were not on the published roster for this run." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Your Attendance" description="Your recorded result for this run." />
      <ul className="divide-y divide-border">
        {own.map((row) => (
          <li key={`${row.characterName}-${row.role ?? "none"}`} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.characterName}</span>
              {row.role ? <RoleBadge role={row.role} /> : null}
              <ParticipationBadge type={row.participationType} />
              {row.isBackup ? <span className="text-xs text-muted">Backup</span> : null}
              <AttendanceStatusBadge status={row.status} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ManagerAttendancePanel({
  runId,
  manager,
  canComplete,
  completeOpen,
  onCompleteOpen,
  onCompleteClose,
}: {
  runId: string;
  manager: NonNullable<RunDetailView["attendance"]["manager"]>;
  canComplete: boolean;
  completeOpen: boolean;
  onCompleteOpen: () => void;
  onCompleteClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteRowId, setNoteRowId] = useState<string | null>(null);
  const [strikeRowId, setStrikeRowId] = useState<string | null>(null);
  const canMutate = manager.canMutate;
  const unmarked = manager.summary.unmarked;

  function runMutation(action: () => Promise<{ ok: boolean; message: string }>) {
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

  return (
    <Card>
      <CardHeader
        title="Attendance"
        description={canMutate ? "Mark exceptions first, then mark everyone else present." : "Final attendance for this run."}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {canMutate ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending || unmarked === 0}
                onClick={() => runMutation(() => markAllPresentAction({ runId }))}
              >
                Mark all unmarked as Present
              </Button>
            ) : null}
            {canComplete ? (
              <Button type="button" disabled={pending} onClick={onCompleteOpen}>
                Complete Run{unmarked > 0 ? ` (${unmarked} unmarked)` : ""}
              </Button>
            ) : null}
          </div>
        }
      />
      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {!canMutate ? (
        <div className="flex flex-wrap gap-3 px-4 py-3 text-xs text-muted">
          {SUMMARY_ORDER.map((status) => (
            <span key={status}>
              {ATTENDANCE_STATUS_LABELS[status]} {manager.summary.counts[status]}
            </span>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-[44rem] w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Character</th>
              <th className="px-3 py-2 font-medium">Class / Role</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Backup</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-4 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {manager.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70">
                <td className="px-4 py-2">
                  <div className="font-medium">{row.characterName}</div>
                  <div className="text-xs text-muted">{row.userName}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.wowClass ? <ClassBadge wowClass={row.wowClass} /> : <span className="text-muted">—</span>}
                    {row.role ? <RoleBadge role={row.role} /> : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <ParticipationBadge type={row.participationType} />
                </td>
                <td className="px-3 py-2">{row.isBackup ? "Backup" : "—"}</td>
                <td className="px-3 py-2">
                  {canMutate ? (
                    <label className="block">
                      <span className="sr-only">Attendance status for {row.characterName}</span>
                      <select
                        className="h-9 w-full min-w-[8.5rem] rounded-md border border-border bg-surface-raised px-2 text-sm"
                        value={row.status}
                        disabled={pending}
                        onChange={(event) =>
                          runMutation(() =>
                            setAttendanceAction({
                              attendanceId: row.id,
                              status: event.target.value,
                              note: row.note,
                            }),
                          )
                        }
                      >
                        {ATTENDANCE_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {ATTENDANCE_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <AttendanceStatusBadge status={row.status} />
                  )}
                </td>
                <td className="max-w-[12rem] px-3 py-2 text-xs text-muted">
                  {row.note ? row.note : "—"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    {canMutate && row.isBackup && row.status !== "STANDBY" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8"
                        disabled={pending}
                        onClick={() =>
                          runMutation(() =>
                            setAttendanceAction({
                              attendanceId: row.id,
                              status: "STANDBY",
                              note: row.note,
                            }),
                          )
                        }
                      >
                        Standby
                      </Button>
                    ) : null}
                    {canMutate ? (
                      <Button type="button" variant="ghost" className="h-8" onClick={() => setNoteRowId(row.id)}>
                        Note
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8"
                      onClick={() => setStrikeRowId(row.id)}
                    >
                      Add strike
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {noteRowId ? (
        <AttendanceNoteDialog
          row={manager.rows.find((item) => item.id === noteRowId) ?? null}
          pending={pending}
          onClose={() => setNoteRowId(null)}
          onSave={(status, note) => {
            setNoteRowId(null);
            runMutation(() => setAttendanceAction({ attendanceId: noteRowId, status, note }));
          }}
        />
      ) : null}
      {completeOpen ? (
        <RunCompleteDialog runId={runId} unmarkedCount={unmarked} onClose={onCompleteClose} />
      ) : null}
      {strikeRowId ? (
        <AddStrikeFromAttendanceDialog
          attendanceId={strikeRowId}
          characterName={manager.rows.find((item) => item.id === strikeRowId)?.characterName ?? "this participant"}
          onClose={() => setStrikeRowId(null)}
        />
      ) : null}
    </Card>
  );
}

function AttendanceNoteDialog({
  row,
  pending,
  onClose,
  onSave,
}: {
  row: NonNullable<RunDetailView["attendance"]["manager"]>["rows"][number] | null;
  pending: boolean;
  onClose: () => void;
  onSave: (status: AttendanceStatus, note: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState(row?.note ?? "");

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  if (!row) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(row.status, note);
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            Attendance note for {row.characterName}
          </h2>
        </div>
        <div className="px-4 py-3">
          <label htmlFor={noteId} className="mb-1 block text-xs text-muted">
            Optional note (manager only)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={ATTENDANCE_NOTE_MAX}
            rows={3}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Save note
          </Button>
        </div>
      </form>
    </dialog>
  );
}
