"use client";

import { useEffect, useRef, useState } from "react";
import { listScheduleAttachCandidatesAction } from "@/controllers/community-schedule.actions";
import type { CommunityWeekday } from "@/models/enums";
import type { AttachCandidate } from "@/services/community-schedule-occurrence.service";

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
 * Per weekly time: create the first occurrence from the Run Setup, or use an
 * existing Run of that raid ID instead (it is linked, never rewritten).
 */
export function FirstOccurrenceSelect({
  weekday,
  localStartTime,
  raidLeadId,
  runTemplateId,
  start,
  value,
  onChange,
}: {
  weekday: CommunityWeekday;
  localStartTime: string;
  raidLeadId: string;
  runTemplateId: string | null;
  /** The dialog's Starts choice: occurrences before it are not offered. */
  start: ScheduleStartState;
  value: string | null;
  onChange: (runId: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<AttachCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const enabled = Boolean(raidLeadId) && /^\d{2}:\d{2}$/.test(localStartTime);
  // Latest selection / setter for the async load without re-running it on every keystroke.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const startMode = start.mode;
  const startDate = start.date;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const startPayload =
        startMode === "FROM_DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
          ? undefined
          : scheduleStartPayload({ mode: startMode, date: startDate });
      const result = await listScheduleAttachCandidatesAction({
        weekday,
        localStartTime,
        raidLeadId,
        runTemplateId,
        start: startPayload,
      });
      if (cancelled) return;
      const next = result.ok ? result.candidates : [];
      setLoadError(result.ok ? null : result.message);
      setCandidates(next);
      // A selection that no longer fits this weekday / time / lead is dropped,
      // so a stale Run is never attached to another occurrence.
      if (valueRef.current && !next.some((candidate) => candidate.runId === valueRef.current)) {
        onChangeRef.current(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, weekday, localStartTime, raidLeadId, runTemplateId, startMode, startDate]);

  const visible = enabled ? candidates : [];
  const selected = visible.find((candidate) => candidate.runId === value) ?? null;
  return (
    <label className="grid w-full gap-1 text-sm">
      <span className="text-xs text-muted">First occurrence</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-9 rounded-md border border-border bg-surface-raised px-2"
      >
        <option value="">Per schedule (create from the Run Setup)</option>
        {visible.map((candidate) => (
          <option key={candidate.runId} value={candidate.runId}>
            Use existing Run · {candidate.label}
          </option>
        ))}
      </select>
      {selected?.warnings.map((warning) => (
        <span key={warning.code} className="text-[11px] text-warning">
          {warning.message}
        </span>
      ))}
      {loadError ? <span className="text-[11px] text-danger">{loadError}</span> : null}
    </label>
  );
}
