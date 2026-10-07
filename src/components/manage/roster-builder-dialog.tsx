"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  applyRosterBuilderAction,
  proposeRosterBuilderAction,
} from "@/controllers/roster.actions";
import { formatDateTime } from "@/lib/datetime";
import {
  formatCompositionCounts,
  formatMissingCounts,
} from "@/lib/run-staffing";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  RUN_LOOT_TYPE_LABELS,
} from "@/lib/labels";
import type { RosterBuilderResult } from "@/services/roster-builder.service";
import type { RosterBuilderProposedPick } from "@/services/roster-builder-optimizer";
import { summarizeRaidBuffCoverageByClass } from "@/services/roster-raid-buffs";

function PickRow({ pick }: { pick: RosterBuilderProposedPick }) {
  const label =
    pick.characterName != null
      ? `${pick.characterName} · ${pick.userName}`
      : pick.userName;
  const classLabel = pick.wowClass
    ? (CLASS_LABELS[pick.wowClass] ?? pick.wowClass)
    : null;
  const roleLabel = pick.selectedRole
    ? (CHARACTER_ROLE_LABELS[pick.selectedRole] ?? pick.selectedRole)
    : pick.participationType === "LOOTBUDDY"
      ? "Lootbuddy"
      : null;
  const meta = [
    classLabel,
    roleLabel,
    pick.itemLevel != null ? String(pick.itemLevel) : null,
    pick.wclPct != null ? `WCL ${Math.round(pick.wclPct)}` : null,
  ].filter(Boolean);

  return (
    <li className="border-b border-border/60 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-medium">
          {pick.locked ? "• " : "✓ "}
          {label}
        </span>
        {meta.length > 0 ? <span className="text-muted">{meta.join(" · ")}</span> : null}
        {pick.lockoutAttention ? (
          <span className="text-[10px] uppercase tracking-wide text-warning">Lockout</span>
        ) : null}
        {pick.locked ? (
          <span className="text-[10px] uppercase tracking-wide text-muted">Existing</span>
        ) : null}
      </div>
      {pick.reasonLabels.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-muted">{pick.reasonLabels.join(" · ")}</p>
      ) : null}
    </li>
  );
}

function BucketSection({
  title,
  picks,
}: {
  title: string;
  picks: RosterBuilderProposedPick[];
}) {
  if (picks.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">
        {title} · {picks.length}
      </h3>
      <ul className="mt-1">
        {picks.map((pick) => (
          <PickRow key={pick.signupId} pick={pick} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Roster Builder — generates a deterministic proposal from Run signups.
 * Apply uses existing draft selection authority. Opening never mutates.
 */
export function RosterBuilderDialog({
  runId,
  onClose,
  onApplied,
}: {
  runId: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RosterBuilderResult | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await proposeRosterBuilderAction({ runId });
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setError(result.message);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  function handleApply() {
    if (!data || data.applySelections.length === 0) return;
    setApplying(true);
    startTransition(async () => {
      const result = await applyRosterBuilderAction({
        runId,
        expectedVersion: data.rosterVersion,
        selections: data.applySelections,
      });
      setApplying(false);
      if (!result.ok || !result.data) {
        setError(result.message);
        return;
      }
      setData(result.data);
      setError(null);
      onApplied?.();
      dialogRef.current?.close();
    });
  }

  const classCoverage = data ? summarizeRaidBuffCoverageByClass(data.buffCoverage) : null;
  const tanks = data?.proposed.filter((row) => row.bucket === "TANK") ?? [];
  const healers = data?.proposed.filter((row) => row.bucket === "HEALER") ?? [];
  const dps = data?.proposed.filter((row) => row.bucket === "DPS") ?? [];
  const lootbuddies = data?.proposed.filter((row) => row.bucket === "LOOTBUDDY") ?? [];
  const canApply = Boolean(data && !data.fullyStaffed && data.applySelections.length > 0);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(40rem,calc(100vw-2rem))] max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          Roster Builder
        </h2>
        {data ? (
          <p className="mt-1 text-xs text-muted">
            {data.run.productLabel} · {DIFFICULTY_LABELS[data.run.difficulty as keyof typeof DIFFICULTY_LABELS] ?? data.run.difficulty}{" "}
            {RUN_LOOT_TYPE_LABELS[data.run.lootType as keyof typeof RUN_LOOT_TYPE_LABELS] ?? data.run.lootType} ·{" "}
            {formatDateTime(data.run.scheduledStartAt)}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Deterministic proposal from this Run&apos;s signups — review, then Apply.
          </p>
        )}
      </div>

      <div className="space-y-4 px-4 py-4">
        {pending && !data ? <p className="text-sm text-muted">Building proposal…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {data?.fullyStaffed ? (
          <p className="text-sm font-medium text-success">Roster is fully staffed.</p>
        ) : null}

        {data && !data.fullyStaffed ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Target</p>
                <p className="mt-0.5">{formatCompositionCounts(data.staffing.desired)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Needed</p>
                <p className="mt-0.5">{formatMissingCounts(data.shortages) || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Proposed</p>
                <p className="mt-0.5">
                  {formatCompositionCounts({
                    tanks: tanks.length,
                    healers: healers.length,
                    dps: dps.length,
                    lootbuddies: lootbuddies.length,
                  })}
                </p>
              </div>
              {classCoverage ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Buff coverage
                  </p>
                  <p className="mt-0.5">
                    {classCoverage.coveredCount}/{classCoverage.totalCount} provider classes
                  </p>
                </div>
              ) : null}
            </div>

            <BucketSection title="Tanks" picks={tanks} />
            <BucketSection title="Healers" picks={healers} />
            <BucketSection title="DPS" picks={dps} />
            <BucketSection title="Lootbuddies" picks={lootbuddies} />

            {data.warnings.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-warning">Warnings</p>
                <ul className="mt-1 space-y-0.5 text-xs text-warning">
                  {data.warnings.map((row) => (
                    <li key={row.signupId}>{row.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.unselected.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">
                  Other eligible signups · {data.unselected.length}
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {data.unselected.slice(0, 40).map((row) => (
                    <li key={row.signupId}>
                      {(row.characterName ?? row.userName) +
                        (row.itemLevel != null ? ` · ${row.itemLevel}` : "") +
                        (row.wclPct != null ? ` · WCL ${Math.round(row.wclPct)}` : "") +
                        ` — ${row.skipReason}`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {data.missingAfterProposal.tanks +
              data.missingAfterProposal.healers +
              data.missingAfterProposal.dps +
              data.missingAfterProposal.lootbuddies >
            0 ? (
              <p className="text-xs text-warning">
                Still short after proposal: {formatMissingCounts(data.missingAfterProposal)}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-raised"
          onClick={() => dialogRef.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canApply || applying || pending}
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-black hover:bg-[#d8b436] disabled:opacity-50"
          onClick={handleApply}
        >
          {applying ? "Applying…" : "Apply Roster"}
        </button>
      </div>
    </dialog>
  );
}

export function RosterBuilderTrigger({
  runId,
  onApplied,
}: {
  runId: string;
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
      >
        Auto Build Roster
      </button>
      {open ? (
        <RosterBuilderDialog
          runId={runId}
          onClose={() => setOpen(false)}
          onApplied={onApplied}
        />
      ) : null}
    </>
  );
}
