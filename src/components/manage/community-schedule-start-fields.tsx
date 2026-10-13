"use client";

import { useEffect, useRef, useState } from "react";
import { listScheduleAdoptionCandidatesAction } from "@/controllers/community-schedule.actions";
import type { AdoptionCandidate } from "@/services/community-schedule-occurrence.service";

export type ScheduleStartMode = "KEEP" | "IMMEDIATE" | "NEXT_RAID_ID" | "SKIP_FIRST" | "FROM_DATE";
export type ScheduleStartState = { mode: ScheduleStartMode; date: string };

export const DEFAULT_SCHEDULE_START: ScheduleStartState = { mode: "IMMEDIATE", date: "" };

/** Request payload for a start choice; KEEP → omitted (the server keeps the boundary). */
export function scheduleStartPayload(state: ScheduleStartState):
  | { mode: "IMMEDIATE" | "NEXT_RAID_ID" | "SKIP_FIRST" }
  | { mode: "FROM_DATE"; date: string }
  | undefined {
  if (state.mode === "KEEP") return undefined;
  if (state.mode === "FROM_DATE") return { mode: "FROM_DATE", date: state.date };
  return { mode: state.mode };
}

/** "Starts" control: when the materializer may create this slot's Runs. */
export function ScheduleStartField({
  value,
  onChange,
  keepLabel,
}: {
  value: ScheduleStartState;
  onChange: (next: ScheduleStartState) => void;
  /** Edit form: offer "keep current" (with the current start shown). */
  keepLabel?: string;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="text-xs text-muted">Starts</span>
      <div className="flex flex-wrap gap-2">
        <select
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as ScheduleStartMode })}
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-border bg-surface-raised px-2"
        >
          {keepLabel ? <option value="KEEP">{keepLabel}</option> : null}
          <option value="IMMEDIATE">Immediately</option>
          <option value="NEXT_RAID_ID">Next raid ID</option>
          <option value="SKIP_FIRST">Skip the next occurrence</option>
          <option value="FROM_DATE">From date…</option>
        </select>
        {value.mode === "FROM_DATE" ? (
          <input
            type="date"
            required
            value={value.date}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
            className="h-9 rounded-md border border-border bg-surface-raised px-2"
          />
        ) : null}
      </div>
      <span className="text-[11px] text-muted">
        Raid IDs reset Wednesday 06:00 (Europe/Berlin). Occurrences before the start are never created
        automatically; existing Runs are never changed.
      </span>
    </div>
  );
}

/**
 * Existing Runs a NEW Schedule time can use as its first occurrence (upcoming,
 * unlinked, on/after the chosen Starts), each with the configuration it brings:
 * weekday / time (Europe/Berlin), Raid Lead and Run Setup. `onAvailable`
 * receives the ids after every load so callers can drop selections that no
 * longer qualify (e.g. a later Starts).
 *
 * `openKey` identifies one opening of the dialog (null = closed): the list is
 * loaded fresh for every opening and a list from an earlier opening is never
 * shown (Runs may have been attached meanwhile).
 */
export function useAdoptionCandidates(
  start: ScheduleStartState,
  onAvailable: (runIds: ReadonlySet<string>) => void,
  openKey: number | null,
): { candidates: AdoptionCandidate[]; loadError: string | null } {
  const [loaded, setLoaded] = useState<{
    openKey: number;
    candidates: AdoptionCandidate[];
    loadError: string | null;
  } | null>(null);
  const onAvailableRef = useRef(onAvailable);
  useEffect(() => {
    onAvailableRef.current = onAvailable;
  });

  const startMode = start.mode;
  const startDate = start.date;

  useEffect(() => {
    if (openKey == null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const startPayload =
        startMode === "FROM_DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
          ? undefined
          : scheduleStartPayload({ mode: startMode, date: startDate });
      const result = await listScheduleAdoptionCandidatesAction({ start: startPayload });
      if (cancelled) return;
      const next = result.ok ? result.candidates : [];
      setLoaded({ openKey, candidates: next, loadError: result.ok ? null : result.message });
      onAvailableRef.current(new Set(next.map((candidate) => candidate.runId)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [startMode, startDate, openKey]);

  const current = loaded && loaded.openKey === openKey ? loaded : null;
  return { candidates: current?.candidates ?? [], loadError: current?.loadError ?? null };
}

/**
 * The one "first occurrence" control: Create normally, or Use existing Run.
 * Picking a Run sets this time's weekday / time from the Run (the caller
 * applies it); the Run itself is never changed.
 */
export function FirstOccurrenceField({
  candidates,
  unavailableRunIds,
  value,
  onChange,
  loadError,
}: {
  candidates: readonly AdoptionCandidate[];
  /** Runs already chosen for another time in this dialog. */
  unavailableRunIds: ReadonlySet<string>;
  value: string | null;
  onChange: (candidate: AdoptionCandidate | null) => void;
  loadError?: string | null;
}) {
  const [useExisting, setUseExisting] = useState(value != null);
  const options = candidates.filter(
    (candidate) => candidate.runId === value || !unavailableRunIds.has(candidate.runId),
  );
  return (
    <div className="grid w-full gap-1 text-sm">
      <span className="text-xs text-muted">First occurrence</span>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={!useExisting}
            onChange={() => {
              setUseExisting(false);
              onChange(null);
            }}
          />
          Create normally
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={useExisting} onChange={() => setUseExisting(true)} />
          Use existing Run
        </label>
      </div>
      {useExisting ? (
        <select
          aria-label="Existing Run"
          value={value ?? ""}
          onChange={(event) =>
            onChange(candidates.find((candidate) => candidate.runId === event.target.value) ?? null)
          }
          className="h-9 rounded-md border border-border bg-surface-raised px-2"
        >
          <option value="">Select an existing Run…</option>
          {options.map((candidate) => (
            <option key={candidate.runId} value={candidate.runId}>
              {candidate.label}
            </option>
          ))}
        </select>
      ) : null}
      {useExisting && options.length === 0 && !loadError ? (
        <span className="text-[11px] text-muted">
          No eligible Run (upcoming, not linked to a schedule, on/after the chosen start).
        </span>
      ) : null}
      {loadError ? <span className="text-[11px] text-danger">{loadError}</span> : null}
    </div>
  );
}
