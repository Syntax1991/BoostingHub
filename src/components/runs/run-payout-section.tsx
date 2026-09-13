"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  finalizeRunPayoutAction,
  markRunPayoutPaidAction,
  prepareRunPayoutAction,
  updateRunPayoutFinancialsAction,
  updateRunPayoutShareAction,
} from "@/controllers/payout.actions";
import { Button } from "@/components/ui/button";
import {
  AttendanceStatusBadge,
  ParticipationBadge,
  RoleBadge,
  SettlementStatusBadge,
} from "@/components/ui/badges";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatGold } from "@/lib/gold";
import {
  ATTENDANCE_STATUS_LABELS,
  RAID_LEAD_CUT_MODE_LABELS,
  SETTLEMENT_STATUS_LABELS,
} from "@/lib/labels";
import type { RaidLeadCutMode } from "@/models/enums";
import {
  PAYOUT_ADJUSTMENT_REASON_MAX,
  SHARE_UNITS_MAX,
  SHARE_UNITS_MIN,
  TOTAL_GOLD_MAX,
  TOTAL_GOLD_MIN,
} from "@/services/payout-state";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunPayoutSection({ data }: { data: RunDetailView }) {
  const payout = data.payout;
  const manager = payout.manager;
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);

  if (manager) {
    return (
      <ManagerPayoutPanel
        runId={data.run.id}
        manager={manager}
        canEdit={payout.capabilities.canEditDraft}
        canFinalize={payout.capabilities.canFinalize}
        canMarkPaid={payout.capabilities.canMarkPaid}
        finalizeOpen={finalizeOpen}
        paidOpen={paidOpen}
        onFinalizeOpen={() => setFinalizeOpen(true)}
        onFinalizeClose={() => setFinalizeOpen(false)}
        onPaidOpen={() => setPaidOpen(true)}
        onPaidClose={() => setPaidOpen(false)}
      />
    );
  }

  if (payout.capabilities.canPrepare) {
    return (
      <Card>
        <CardHeader
          title="Payout"
          description="Enter the current pot (for example from Dawn) and optional Raid Lead cut. This is not a wallet or transfer."
        />
        <div className="space-y-3 px-4 py-4 text-sm">
          <p>No settlement exists yet.</p>
          <Button type="button" onClick={() => setPrepareOpen(true)}>
            Prepare Payout
          </Button>
        </div>
        {prepareOpen ? (
          <PreparePayoutDialog runId={data.run.id} onClose={() => setPrepareOpen(false)} />
        ) : null}
      </Card>
    );
  }

  if (data.run.status !== "COMPLETED") {
    return (
      <Card>
        <CardHeader title="Payout" />
        <p className="px-4 py-4 text-sm text-muted">Payout is available after the run is completed.</p>
      </Card>
    );
  }

  if (!payout.available) {
    return (
      <Card>
        <CardHeader title="Payout" />
        <p className="px-4 py-4 text-sm text-muted">Payout not available yet.</p>
      </Card>
    );
  }

  if (payout.own.length === 0 && !payout.ownRaidLeadCut) {
    return (
      <Card>
        <CardHeader title="Payout" />
        <EmptyState title="No payout for you" description="You do not have a payout line on this settlement." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Your Payout" description="Your finalized gold share for this run." />
      <ul className="divide-y divide-border">
        {payout.own.map((row) => (
          <li key={`${row.characterName}-${row.participationType}`} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.characterName}</span>
              {row.role ? <RoleBadge role={row.role} /> : null}
              <ParticipationBadge type={row.participationType} />
              <AttendanceStatusBadge status={row.attendanceStatus} />
              <SettlementStatusBadge status={row.settlementStatus} />
            </div>
            <p className="mt-1 text-muted">
              Share {row.shareUnits} · {formatGold(row.amountGold)}
              {row.settlementStatus === "PAID" ? " · Paid" : ""}
            </p>
          </li>
        ))}
        {payout.ownRaidLeadCut ? (
          <li className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Raid Lead cut</span>
              <SettlementStatusBadge status={payout.ownRaidLeadCut.settlementStatus} />
            </div>
            <p className="mt-1 text-muted">
              Dedicated KEEP payout · {formatGold(payout.ownRaidLeadCut.amountGold)}
              {payout.ownRaidLeadCut.settlementStatus === "PAID" ? " · Paid" : ""}
            </p>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

function ManagerPayoutPanel({
  runId,
  manager,
  canEdit,
  canFinalize,
  canMarkPaid,
  finalizeOpen,
  paidOpen,
  onFinalizeOpen,
  onFinalizeClose,
  onPaidOpen,
  onPaidClose,
}: {
  runId: string;
  manager: NonNullable<RunDetailView["payout"]["manager"]>;
  canEdit: boolean;
  canFinalize: boolean;
  canMarkPaid: boolean;
  finalizeOpen: boolean;
  paidOpen: boolean;
  onFinalizeOpen: () => void;
  onFinalizeClose: () => void;
  onPaidOpen: () => void;
  onPaidClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const totalId = useId();
  const cutId = useId();
  const [totalGold, setTotalGold] = useState(String(manager.totalGold));
  const [raidLeadCutGold, setRaidLeadCutGold] = useState(String(manager.raidLeadCutGold));
  const [raidLeadCutMode, setRaidLeadCutMode] = useState<RaidLeadCutMode>(manager.raidLeadCutMode);

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

  const summary = manager.summary;

  return (
    <Card>
      <CardHeader
        title="Payout"
        description={
          canEdit
            ? "Whole gold only. Updating pot or Raid Lead cut recalculates the settlement preview on the server."
            : "Final settlement for this completed run."
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SettlementStatusBadge status={manager.status} />
            <span className="sr-only">Settlement status {SETTLEMENT_STATUS_LABELS[manager.status]}</span>
            {canFinalize ? (
              <Button type="button" disabled={pending} onClick={onFinalizeOpen}>
                Finalize Payout
              </Button>
            ) : null}
            {canMarkPaid ? (
              <Button type="button" disabled={pending} onClick={onPaidOpen}>
                Mark Paid
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

      <SettlementFinancialSummary
        status={manager.status}
        totalGold={summary.totalGold}
        raidLeadCutGold={summary.raidLeadCutGold}
        raidLeadCutMode={summary.raidLeadCutMode}
        dedicatedRaidLeadPayout={summary.dedicatedRaidLeadPayout}
        distributablePool={summary.distributablePool}
        raidLeadName={manager.raidLeadName}
      />

      <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-muted">
        <span>Share units {summary.totalShareUnits}</span>
        <span>Recipients with share {summary.recipientsWithShare}</span>
        <span>Zero-share {summary.zeroShareParticipants}</span>
        <span>Participant distributed {formatGold(summary.distributedGold)}</span>
        <span>Pool remainder {formatGold(summary.remainder)}</span>
        <span>Total allocated {formatGold(summary.totalAllocatedGold)}</span>
      </div>

      {canEdit ? (
        <form
          className="space-y-3 px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            runMutation(() =>
              updateRunPayoutFinancialsAction({
                settlementId: manager.id,
                totalGold: Number(totalGold),
                raidLeadCutMode,
                raidLeadCutGold: Number(raidLeadCutGold),
              }),
            );
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={totalId} className="mb-1 block text-xs text-muted">
                Pot
              </label>
              <input
                id={totalId}
                type="number"
                inputMode="numeric"
                min={TOTAL_GOLD_MIN}
                max={TOTAL_GOLD_MAX}
                step={1}
                value={totalGold}
                onChange={(event) => setTotalGold(event.target.value)}
                className="h-9 w-40 rounded-md border border-border bg-surface-raised px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted">Enter the current pot. Updating it recalculates the settlement preview.</p>
            </div>
            <div>
              <label htmlFor={cutId} className="mb-1 block text-xs text-muted">
                Raid Lead cut
              </label>
              <input
                id={cutId}
                type="number"
                inputMode="numeric"
                min={0}
                max={TOTAL_GOLD_MAX}
                step={1}
                value={raidLeadCutGold}
                onChange={(event) => setRaidLeadCutGold(event.target.value)}
                className="h-9 w-40 rounded-md border border-border bg-surface-raised px-3 text-sm"
              />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs text-muted">Raid Lead cut mode</legend>
              <div className="flex gap-2">
                <ModeToggle
                  mode="KEEP"
                  selected={raidLeadCutMode === "KEEP"}
                  onSelect={() => setRaidLeadCutMode("KEEP")}
                  disabled={pending}
                />
                <ModeToggle
                  mode="SHARE"
                  selected={raidLeadCutMode === "SHARE"}
                  onSelect={() => setRaidLeadCutMode("SHARE")}
                  disabled={pending}
                />
              </div>
            </fieldset>
            <Button type="submit" variant="secondary" disabled={pending}>
              Update settlement
            </Button>
          </div>
          <p className="text-xs text-muted">
            {raidLeadCutMode === "KEEP"
              ? "KEEP: Paid separately to the Raid Lead and deducted from the participant pool."
              : "SHARE: Recorded as the Raid Lead cut but shared with the participant pool; no separate Raid Lead payout."}
          </p>
        </form>
      ) : null}

      <div className="max-w-full min-w-0 overflow-x-auto">
        <table className="min-w-[52rem] w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Character</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Attendance</th>
              <th className="px-3 py-2 font-medium">Backup</th>
              <th className="px-3 py-2 font-medium">Share units</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              {canEdit ? <th className="px-4 py-2 font-medium">Reason</th> : null}
            </tr>
          </thead>
          <tbody>
            {manager.entries.map((row) => (
              <ManagerPayoutRow
                key={row.id}
                row={row}
                canEdit={canEdit}
                pending={pending}
                isRaidLead={row.userId === manager.raidLeadUserId}
                dedicatedRaidLeadPayout={summary.dedicatedRaidLeadPayout}
                onSave={(shareUnits, adjustmentReason) =>
                  runMutation(() =>
                    updateRunPayoutShareAction({
                      payoutEntryId: row.id,
                      shareUnits,
                      adjustmentReason,
                    }),
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      {summary.dedicatedRaidLeadPayout > 0 ? (
        <div className="border-t border-border px-4 py-3 text-sm">
          <p className="font-medium">
            Raid Lead receives separately · {formatGold(summary.dedicatedRaidLeadPayout)}
          </p>
          <p className="text-xs text-muted">
            Dedicated KEEP cut for {manager.raidLeadName}. Not an attendance share.
          </p>
        </div>
      ) : null}
      {finalizeOpen ? (
        <FinalizePayoutDialog
          settlementId={manager.id}
          totalGold={manager.totalGold}
          dedicatedRaidLeadPayout={summary.dedicatedRaidLeadPayout}
          distributablePool={summary.distributablePool}
          raidLeadCutMode={manager.raidLeadCutMode}
          onClose={onFinalizeClose}
        />
      ) : null}
      {paidOpen ? <MarkPaidDialog settlementId={manager.id} onClose={onPaidClose} /> : null}
      <p className="sr-only">Run {runId}</p>
    </Card>
  );
}

function SettlementFinancialSummary({
  status,
  totalGold,
  raidLeadCutGold,
  raidLeadCutMode,
  dedicatedRaidLeadPayout,
  distributablePool,
  raidLeadName,
}: {
  status: NonNullable<RunDetailView["payout"]["manager"]>["status"];
  totalGold: number;
  raidLeadCutGold: number;
  raidLeadCutMode: RaidLeadCutMode;
  dedicatedRaidLeadPayout: number;
  distributablePool: number;
  raidLeadName: string;
}) {
  const potLabel = status === "DRAFT" ? "Pot" : "Final pot";
  return (
    <div className="mx-4 mt-3 grid gap-2 rounded-md border border-border bg-surface-raised/40 px-3 py-3 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted">{potLabel}</p>
        <p className="font-medium">{formatGold(totalGold)}</p>
      </div>
      <div>
        <p className="text-xs text-muted">Raid Lead cut</p>
        <p className="font-medium">
          {formatGold(raidLeadCutGold)} · {RAID_LEAD_CUT_MODE_LABELS[raidLeadCutMode]}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Raid Lead receives separately</p>
        <p className="font-medium">{formatGold(dedicatedRaidLeadPayout)}</p>
        <p className="text-xs text-muted">{raidLeadName}</p>
      </div>
      <div>
        <p className="text-xs text-muted">Participant pool</p>
        <p className="font-medium">{formatGold(distributablePool)}</p>
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  selected,
  onSelect,
  disabled,
}: {
  mode: RaidLeadCutMode;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={`h-9 rounded-md border px-3 text-sm ${
        selected
          ? "border-accent bg-accent/15 font-medium text-foreground"
          : "border-border bg-surface-raised text-muted"
      }`}
    >
      {RAID_LEAD_CUT_MODE_LABELS[mode]}
    </button>
  );
}

function ManagerPayoutRow({
  row,
  canEdit,
  pending,
  isRaidLead,
  dedicatedRaidLeadPayout,
  onSave,
}: {
  row: NonNullable<RunDetailView["payout"]["manager"]>["entries"][number];
  canEdit: boolean;
  pending: boolean;
  isRaidLead: boolean;
  dedicatedRaidLeadPayout: number;
  onSave: (shareUnits: number, adjustmentReason: string | null) => void;
}) {
  const shareId = useId();
  const reasonId = useId();
  const [shareUnits, setShareUnits] = useState(String(row.shareUnits));
  const [reason, setReason] = useState(row.adjustmentReason ?? "");

  return (
    <tr className="border-b border-border/70">
      <td className="px-4 py-2">
        <div className="font-medium">{row.characterName}</div>
        <div className="text-xs text-muted">{row.userDisplayName}</div>
        {isRaidLead && dedicatedRaidLeadPayout > 0 ? (
          <div className="mt-1 text-xs text-muted">
            Attendance {formatGold(row.amountGold)} + KEEP cut {formatGold(dedicatedRaidLeadPayout)} ={" "}
            {formatGold(row.amountGold + dedicatedRaidLeadPayout)}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <ParticipationBadge type={row.participationType} />
      </td>
      <td className="px-3 py-2">
        <AttendanceStatusBadge status={row.attendanceStatus} />
        <span className="sr-only">{ATTENDANCE_STATUS_LABELS[row.attendanceStatus]}</span>
      </td>
      <td className="px-3 py-2">{row.isBackup ? "Backup" : "—"}</td>
      <td className="px-3 py-2">
        {canEdit ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSave(Number(shareUnits), reason);
            }}
          >
            <label htmlFor={shareId} className="sr-only">
              Share units for {row.characterName}
            </label>
            <input
              id={shareId}
              type="number"
              inputMode="numeric"
              min={SHARE_UNITS_MIN}
              max={SHARE_UNITS_MAX}
              step={1}
              value={shareUnits}
              disabled={pending}
              onChange={(event) => setShareUnits(event.target.value)}
              className="h-9 w-20 rounded-md border border-border bg-surface-raised px-2 text-sm"
            />
            <Button type="submit" variant="secondary" className="h-8" disabled={pending}>
              Save
            </Button>
          </form>
        ) : (
          <span>{row.shareUnits}</span>
        )}
      </td>
      <td className="px-3 py-2 font-medium">{formatGold(row.amountGold)}</td>
      {canEdit ? (
        <td className="px-4 py-2">
          <label htmlFor={reasonId} className="sr-only">
            Adjustment reason for {row.characterName}
          </label>
          <input
            id={reasonId}
            value={reason}
            maxLength={PAYOUT_ADJUSTMENT_REASON_MAX}
            placeholder="Optional"
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            className="h-9 w-40 rounded-md border border-border bg-surface-raised px-2 text-xs"
          />
        </td>
      ) : null}
    </tr>
  );
}

function PreparePayoutDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const goldId = useId();
  const cutId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [totalGold, setTotalGold] = useState("");
  const [raidLeadCutGold, setRaidLeadCutGold] = useState("0");
  const [raidLeadCutMode, setRaidLeadCutMode] = useState<RaidLeadCutMode>("SHARE");

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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await prepareRunPayoutAction({
              runId,
              totalGold: Number(totalGold),
              raidLeadCutMode,
              raidLeadCutGold: Number(raidLeadCutGold),
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            close();
            window.location.reload();
          });
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            Prepare payout
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm">
          {error ? (
            <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              {error}
            </p>
          ) : null}
          <p>
            Enter the current pot (manual Dawn/community total) and the declared Raid Lead cut. You can change the pot
            while the settlement stays a draft. No gold is transferred automatically.
          </p>
          <div>
            <label htmlFor={goldId} className="mb-1 block text-xs text-muted">
              Pot
            </label>
            <input
              id={goldId}
              type="number"
              inputMode="numeric"
              required
              min={TOTAL_GOLD_MIN}
              max={TOTAL_GOLD_MAX}
              step={1}
              value={totalGold}
              onChange={(event) => setTotalGold(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted">Enter the current pot. Updating it recalculates the settlement preview.</p>
          </div>
          <div>
            <label htmlFor={cutId} className="mb-1 block text-xs text-muted">
              Raid Lead cut
            </label>
            <input
              id={cutId}
              type="number"
              inputMode="numeric"
              required
              min={0}
              max={TOTAL_GOLD_MAX}
              step={1}
              value={raidLeadCutGold}
              onChange={(event) => setRaidLeadCutGold(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-3 text-sm"
            />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Raid Lead cut mode</legend>
            <div className="flex gap-2">
              <ModeToggle
                mode="KEEP"
                selected={raidLeadCutMode === "KEEP"}
                onSelect={() => setRaidLeadCutMode("KEEP")}
                disabled={pending}
              />
              <ModeToggle
                mode="SHARE"
                selected={raidLeadCutMode === "SHARE"}
                onSelect={() => setRaidLeadCutMode("SHARE")}
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted">
              {raidLeadCutMode === "KEEP"
                ? "KEEP: Paid separately to the Raid Lead and deducted from the participant pool."
                : "SHARE: Recorded as the Raid Lead cut but shared with the participant pool; no separate Raid Lead payout."}
            </p>
          </fieldset>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Preparing…" : "Prepare payout"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function FinalizePayoutDialog({
  settlementId,
  totalGold,
  dedicatedRaidLeadPayout,
  distributablePool,
  raidLeadCutMode,
  onClose,
}: {
  settlementId: string;
  totalGold: number;
  dedicatedRaidLeadPayout: number;
  distributablePool: number;
  raidLeadCutMode: RaidLeadCutMode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Finalize payout?
        </h2>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        <p>
          Finalizing locks the current pot of {formatGold(totalGold)} ({RAID_LEAD_CUT_MODE_LABELS[raidLeadCutMode]}), the
          participant pool {formatGold(distributablePool)}, and the separate Raid Lead payout{" "}
          {formatGold(dedicatedRaidLeadPayout)}. Totals, recipients, and amounts cannot be edited afterwards.
        </p>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Keep draft
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await finalizeRunPayoutAction({ settlementId });
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                close();
                window.location.reload();
              });
            }}
          >
            {pending ? "Finalizing…" : "Finalize payout"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function MarkPaidDialog({ settlementId, onClose }: { settlementId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Mark settlement paid?
        </h2>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        <p>
          This is a bookkeeping marker for the whole settlement. No gold is transferred, no wallet is updated, and the
          settlement stays immutable.
        </p>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await markRunPayoutPaidAction({ settlementId });
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                close();
                window.location.reload();
              });
            }}
          >
            {pending ? "Saving…" : "Mark paid"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
