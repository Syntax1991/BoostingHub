"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { correctAttendanceAction } from "@/controllers/attendance.actions";
import { Button } from "@/components/ui/button";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/labels";
import { MARKABLE_ATTENDANCE_STATUSES, type AttendanceStatus } from "@/models/enums";
import type { RunDetailView } from "@/services/run-detail.service";

type AttendanceRow = NonNullable<RunDetailView["attendance"]["manager"]>["rows"][number];

const REASON_MIN = 5;
const REASON_MAX = 300;

/**
 * Exceptional, audited correction of one attendance status on a COMPLETED Run.
 * Shows the current snapshot; the user explicitly picks the participant, the
 * corrected status and a mandatory reason. The current status travels as the
 * stale-write guard.
 */
export function AttendanceCorrectionDialog({
  runId,
  rows,
  onClose,
}: {
  runId: string;
  rows: AttendanceRow[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attendanceId, setAttendanceId] = useState(rows[0]?.id ?? "");
  const row = useMemo(() => rows.find((candidate) => candidate.id === attendanceId) ?? null, [rows, attendanceId]);
  const targets = MARKABLE_ATTENDANCE_STATUSES.filter((status) => status !== row?.status);
  const [newStatus, setNewStatus] = useState<AttendanceStatus | "">("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  const trimmedReason = reason.trim();
  const canSubmit = Boolean(row && newStatus && newStatus !== row.status && trimmedReason.length >= REASON_MIN);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !newStatus) return;
    setError(null);
    startTransition(async () => {
      const result = await correctAttendanceAction({
        runId,
        attendanceId: row.id,
        expectedCurrentStatus: row.status,
        newStatus,
        reason: trimmedReason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <form className="space-y-3" onSubmit={submit}>
        <div className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            Correct attendance
          </h2>
          <p className="mt-1 text-xs text-muted">
            For exceptional mistakes only. The run stays completed; the correction and its reason are recorded
            permanently in Run History.
          </p>
        </div>
        <div className="space-y-3 px-4">
          {error ? (
            <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Participant</span>
            <select
              aria-label="Participant to correct"
              value={attendanceId}
              onChange={(event) => {
                setAttendanceId(event.target.value);
                setNewStatus("");
              }}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
            >
              {rows.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.characterName} ({candidate.userName}) — {ATTENDANCE_STATUS_LABELS[candidate.status]}
                </option>
              ))}
            </select>
          </label>
          {row ? (
            <p className="text-xs text-muted">
              Current status: <span className="text-foreground">{ATTENDANCE_STATUS_LABELS[row.status]}</span>
              {row.note ? ` · Note: ${row.note}` : ""}
            </p>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Corrected status</span>
            <select
              aria-label="Corrected attendance status"
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value as AttendanceStatus)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
              required
            >
              <option value="">Choose a status…</option>
              {targets.map((status) => (
                <option key={status} value={status}>
                  {ATTENDANCE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason (required)</span>
            <textarea
              aria-label="Correction reason"
              value={reason}
              maxLength={REASON_MAX}
              rows={3}
              placeholder="e.g. Player was incorrectly marked absent."
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted">At least {REASON_MIN} characters.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !canSubmit}>
            {pending ? "Saving…" : "Save correction"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
