"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  applyRosterBuilderAction,
  proposeRosterBuilderAction,
} from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
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
import {
  confirmedWarningsFor,
  RosterWarningConfirmDialog,
} from "@/components/manage/roster-warning-confirm-dialog";
import type { ConfirmedRosterWarning } from "@/services/roster-selection-risk";
import type { CharacterRole } from "@/models/enums";

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

type RosterSelectionInput = { signupId: string; selectedRole: CharacterRole | null };

/** Fill Gaps keeps the current draft and fills what is missing; Build proposes a whole draft from the signups. */
export type RosterBuilderMode = "fill" | "build";

/**
 * Roster Builder — generates a deterministic proposal from Run signups.
 * Opening never mutates.
 *
 * Without `draft` (Run header, Schedule) Apply saves the proposal through the
 * existing draft selection authority. With `draft` (the Roster tab's editor)
 * the proposal is computed on top of that unsaved draft and Apply only hands
 * the result back via `onStage` — the Raid Lead reviews it in the editor and
 * then Saves / Updates as usual (roster version + server checks unchanged).
 */
export function RosterBuilderDialog({
  runId,
  onClose,
  onApplied,
  draft,
  initialMode = "fill",
  onStage,
}: {
  runId: string;
  onClose: () => void;
  onApplied?: () => void;
  draft?: RosterSelectionInput[];
  initialMode?: RosterBuilderMode;
  onStage?: (input: { selections: RosterSelectionInput[]; confirmed: ConfirmedRosterWarning[] }) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RosterBuilderResult | null>(null);
  /** ONE aggregate confirmation for every proposed pick with a warning — never one dialog per Character. */
  const [confirmingWarnings, setConfirmingWarnings] = useState(false);
  /** Build from signups on a non-empty draft: explicit "replace the draft" confirmation before Apply. */
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const stageMode = Boolean(draft && onStage);
  const [mode, setMode] = useState<RosterBuilderMode>(initialMode);
  // Snapshot of the editor draft when the dialog opened — the proposal never chases later edits.
  const [baseDraft] = useState(() => draft ?? null);
  // Every local pick counts — Boosters and Lootbuddies (External Boosters are not draft picks).
  const buildReplacesDraft = stageMode && mode === "build" && (baseDraft?.length ?? 0) > 0;

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  const baseSelections = baseDraft ? (mode === "build" ? [] : baseDraft) : undefined;

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await proposeRosterBuilderAction({ runId, baseSelections });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseSelections derives from mode + the opening snapshot
  }, [runId, mode]);

  /**
   * Build replaces the whole local draft: when it holds any Booster or
   * Lootbuddy, the Raid Lead confirms first. Fill gaps keeps every pick and
   * never asks. `replaceConfirmed` is set only by that confirmation.
   */
  function handleApply(replaceConfirmed = false) {
    if (!data || !canApply) return;
    if (!replaceConfirmed && buildReplacesDraft) {
      setConfirmingReplace(true);
      return;
    }
    if (data.warnings.length > 0) {
      setConfirmingWarnings(true);
      return;
    }
    apply([]);
  }

  /** `confirmed` acknowledges exactly the warnings shown; the server recomputes and re-validates them. */
  function apply(confirmed: ConfirmedRosterWarning[]) {
    if (!data || !canApply) return;
    if (stageMode) {
      onStage?.({ selections: data.fullSelections, confirmed });
      dialogRef.current?.close();
      return;
    }
    setApplying(true);
    startTransition(async () => {
      const result = await applyRosterBuilderAction({
        runId,
        expectedVersion: data.rosterVersion,
        selections: data.applySelections,
        confirmedWarnings: confirmed,
      });
      setApplying(false);
      if (!result.ok || !result.data) {
        if (!result.ok && result.code === "ROSTER_WARNING_CONFIRMATION_REQUIRED") {
          // Lockout state changed after the proposal was shown: nothing was
          // applied. Reload the proposal so the dialog shows the current warnings.
          const refreshed = await proposeRosterBuilderAction({ runId, baseSelections });
          if (refreshed.ok && refreshed.data) setData(refreshed.data);
          setError("Lockout progress changed since this proposal was generated. Review the updated warnings and apply again.");
          return;
        }
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
  const canApply = Boolean(
    data && (stageMode && mode === "build" ? data.fullSelections.length > 0 : !data.fullyStaffed && data.applySelections.length > 0),
  );

  return (
    <>
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(40rem,calc(100vw-2rem))] max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold">
            {stageMode ? "Auto Build Roster" : "Roster Builder"}
          </h2>
          {stageMode ? (
            <div role="group" aria-label="Proposal mode" className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(
                [
                  ["fill", "Fill gaps"],
                  ["build", "Build from signups"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  disabled={pending}
                  onClick={() => {
                    if (mode === value) return;
                    setData(null);
                    setError(null);
                    setMode(value);
                  }}
                  className={`rounded px-2 py-1 font-medium ${
                    mode === value ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
        {stageMode ? (
          <p className="mt-1 text-xs text-muted">
            {mode === "build"
              ? "Proposes a whole draft from the current signups. Replaces all draft Boosters and Lootbuddies; External Boosters stay."
              : "Keeps every current pick and fills only the missing slots from the current signups."}{" "}
            Applies to the draft only — review, then Save / Update.
          </p>
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4">
        {pending && !data ? <p className="text-sm text-muted">Building proposal…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {data?.fullyStaffed && !(stageMode && mode === "build") ? (
          <p className="text-sm font-medium text-success">Roster is fully staffed.</p>
        ) : null}

        {data && (!data.fullyStaffed || (stageMode && mode === "build")) ? (
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
                <p className="text-xs font-medium uppercase tracking-wide text-warning">
                  Saved — needs confirmation on Apply
                </p>
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
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          onClick={() => handleApply()}
        >
          {applying ? "Applying…" : stageMode ? "Apply to draft" : "Apply Roster"}
        </button>
      </div>
    </dialog>
    {confirmingReplace ? (
      <ReplaceDraftConfirmDialog
        draftCount={baseDraft?.length ?? 0}
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          handleApply(true);
        }}
      />
    ) : null}
    {confirmingWarnings && data && data.warnings.length > 0 ? (
      <RosterWarningConfirmDialog
        title={
          data.warnings.length === 1
            ? "1 roster selection needs confirmation"
            : `${data.warnings.length} roster selections need confirmation`
        }
        intro={
          data.warnings.length === 1
            ? `${data.warnings[0]!.characterLabel} already has lockout progress for this Run.`
            : "These proposed Characters already have lockout progress for this Run."
        }
        items={data.warnings.map((row) => ({
          key: row.signupId,
          characterLabel: row.characterLabel,
          warnings: [row.warning],
        }))}
        confirmLabel="Apply anyway"
        pending={applying}
        onCancel={() => setConfirmingWarnings(false)}
        onConfirm={() => {
          const confirmed = data.warnings.flatMap((row) => confirmedWarningsFor(row.signupId, [row.warning]));
          setConfirmingWarnings(false);
          apply(confirmed);
        }}
      />
    ) : null}
    </>
  );
}

/**
 * Build from signups replaces the local draft. Same native-dialog confirm
 * pattern as the roster warning confirmation: Escape / Cancel never applies.
 */
function ReplaceDraftConfirmDialog({
  draftCount,
  onCancel,
  onConfirm,
}: {
  draftCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onDialogCancel = (event: Event) => {
      event.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", onDialogCancel);
    return () => dialog.removeEventListener("cancel", onDialogCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          Replace the current draft?
        </h2>
      </div>
      <div className="space-y-2 px-4 py-4 text-sm">
        <p className="text-warning">This replaces all draft Boosters and Lootbuddies. External Boosters stay.</p>
        <p className="text-muted">
          {draftCount} current pick{draftCount === 1 ? "" : "s"} will be replaced by the proposal. Nothing is saved until
          you Save / Update the roster.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-raised"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-warning/45 bg-warning/15 px-3 text-xs font-medium text-warning hover:bg-warning/25"
          onClick={onConfirm}
        >
          Replace draft
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
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Auto Build Roster
      </Button>
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
