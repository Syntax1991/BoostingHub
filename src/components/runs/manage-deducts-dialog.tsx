"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDeductAction, revokeDeductAction } from "@/controllers/deduct.actions";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { formatGold } from "@/lib/gold";
import type { RunDetailView } from "@/services/run-detail.service";

type ManagerPayoutEntry = NonNullable<RunDetailView["payout"]["manager"]>["entries"][number];

export function ManageDeductsDialog({
  entry,
  canEdit,
  onClose,
}: {
  entry: ManagerPayoutEntry;
  canEdit: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const amountId = useId();
  const reasonId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amountGold, setAmountGold] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

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
  }

  function refresh() {
    router.refresh();
  }

  function submitAdd() {
    const amount = Number(amountGold);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Enter a positive whole gold amount.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addDeductAction({
        payoutEntryId: entry.id,
        amountGold: amount,
        reason,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAmountGold("");
      setReason("");
      setNotes("");
      refresh();
    });
  }

  function submitRevoke(deductId: string) {
    if (!revokeReason.trim()) {
      setError("A reason is required to revoke a deduct.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await revokeDeductAction({ deductId, revokedReason: revokeReason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRevokingId(null);
      setRevokeReason("");
      refresh();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Deducts · {entry.characterName}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Gross {formatGold(entry.grossAmountGold)} · Deducts {formatGold(entry.deductTotal)} · Net{" "}
          {formatGold(entry.netAmountGold)}
        </p>
      </div>
      <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
        {error ? (
          <p id={errorId} role="alert" className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        {entry.deducts.length === 0 ? (
          <p className="text-sm text-muted">No deducts on this entry.</p>
        ) : (
          <ul className="space-y-3">
            {entry.deducts.map((deduct) => (
              <li key={deduct.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{formatGold(deduct.amountGold)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      deduct.status === "ACTIVE" ? "bg-warning/15 text-warning" : "bg-surface-raised text-muted"
                    }`}
                  >
                    {deduct.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{deduct.reason}</p>
                {deduct.notes ? <p className="mt-1 text-xs text-muted">Notes: {deduct.notes}</p> : null}
                <p className="mt-1 text-[11px] text-muted">
                  Added by {deduct.createdByName} · {formatDateTime(deduct.createdAt)}
                </p>
                {deduct.status === "REVOKED" ? (
                  <p className="mt-1 text-[11px] text-muted">
                    Revoked by {deduct.revokedByName ?? "Unknown"}
                    {deduct.revokedAt ? ` · ${formatDateTime(deduct.revokedAt)}` : ""}
                    {deduct.revokedReason ? ` · ${deduct.revokedReason}` : ""}
                  </p>
                ) : canEdit ? (
                  <div className="mt-2">
                    {revokingId === deduct.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          autoFocus
                          value={revokeReason}
                          onChange={(event) => setRevokeReason(event.target.value)}
                          maxLength={500}
                          placeholder="Reason for revoking"
                          className="h-8 min-w-[10rem] flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                        />
                        <Button
                          type="button"
                          className="h-8 px-2 text-xs"
                          disabled={pending}
                          onClick={() => submitRevoke(deduct.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          disabled={pending}
                          onClick={() => {
                            setRevokingId(null);
                            setRevokeReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          setRevokingId(deduct.id);
                          setRevokeReason("");
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit ? (
        <form
          className="space-y-3 border-t border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitAdd();
          }}
        >
          <p className="text-xs font-medium text-muted">Add deduct</p>
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              <span className="sr-only" id={amountId}>
                Amount gold
              </span>
              <input
                aria-labelledby={amountId}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Gold amount"
                value={amountGold}
                onChange={(event) => setAmountGold(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="sr-only" id={reasonId}>
              Reason
            </span>
            <input
              aria-labelledby={reasonId}
              type="text"
              maxLength={200}
              placeholder="Reason (shown once payout is visible)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Internal notes (optional, staff-only)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="h-9">
              {pending ? "Adding…" : "Add deduct"}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="secondary" onClick={close}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
