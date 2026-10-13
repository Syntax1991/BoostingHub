"use client";

import { useState, useTransition } from "react";
import {
  DEFAULT_SCHEDULE_START,
  FirstOccurrenceField,
  ScheduleStartField,
  scheduleStartPayload,
  useAdoptionCandidates,
  type ScheduleStartState,
} from "@/components/manage/community-schedule-start-fields";
import { COMMUNITY_SCHEDULE_RUN_MODES, COMMUNITY_WEEKDAYS } from "@/models/enums";
import type { CommunityScheduleRunMode } from "@/models/enums";
import { MAX_SLOTS_PER_PLAN } from "@/lib/community-schedule";
import { COMMUNITY_SCHEDULE_RUN_MODE_LABELS } from "@/lib/labels";
import { addCommunityScheduleTimesAction } from "@/controllers/community-schedule.actions";
import type { AdoptionCandidate } from "@/services/community-schedule-occurrence.service";

const WEEKDAY_LABELS: Record<(typeof COMMUNITY_WEEKDAYS)[number], string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

type SlotRow = {
  key: string;
  weekday: (typeof COMMUNITY_WEEKDAYS)[number];
  localStartTime: string;
  runMode: CommunityScheduleRunMode;
  /** "Use existing Run" for the first occurrence (null = create per schedule). */
  attachRunId: string | null;
};

function newSlotRow(
  weekday: (typeof COMMUNITY_WEEKDAYS)[number] = "FRIDAY",
  localStartTime = "19:45",
  runMode: CommunityScheduleRunMode = "INHOUSE",
): SlotRow {
  return { key: crypto.randomUUID(), weekday, localStartTime, runMode, attachRunId: null };
}

export function CommunityScheduleAddTimesDialog({
  runTemplateId,
  raidLeadId,
  runSetupName,
}: {
  runTemplateId: string;
  raidLeadId: string;
  runSetupName: string;
}) {
  const [open, setOpen] = useState(false);
  /** Increments per opening, so the existing-Run list is always loaded fresh. */
  const [openKey, setOpenKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [autoCreateRun, setAutoCreateRun] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([newSlotRow()]);
  const [start, setStart] = useState<ScheduleStartState>(DEFAULT_SCHEDULE_START);
  const [notes, setNotes] = useState("");
  // One source of truth: slot.attachRunId (picking a Run sets that time's weekday / time).
  const { candidates, loadError } = useAdoptionCandidates(start, (available) =>
    setSlots((current) =>
      current.some((row) => row.attachRunId && !available.has(row.attachRunId))
        ? current.map((row) =>
            row.attachRunId && !available.has(row.attachRunId) ? { ...row, attachRunId: null } : row,
          )
        : current,
    ),
    open ? openKey : null,
  );
  const chosenRunIds = new Set(slots.flatMap((row) => (row.attachRunId ? [row.attachRunId] : [])));

  /**
   * An existing Run as this time's first occurrence: weekday / time follow the
   * Run. The group's Run Setup and Raid Lead stay authoritative.
   */
  function chooseFirstOccurrence(rowKey: string, candidate: AdoptionCandidate | null) {
    setSlots((current) =>
      current.map((row) =>
        row.key !== rowKey
          ? row
          : candidate
            ? {
                ...row,
                weekday: candidate.weekday,
                localStartTime: candidate.localStartTime,
                attachRunId: candidate.runId,
              }
            : { ...row, attachRunId: null },
      ),
    );
  }

  function resetForm() {
    setError(null);
    setAutoCreateRun(false);
    setSlots([newSlotRow()]);
    setStart(DEFAULT_SCHEDULE_START);
    setNotes("");
  }

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addCommunityScheduleTimesAction({
        runTemplateId,
        raidLeadId,
        slots: slots.map((slot) => ({
          weekday: slot.weekday,
          localStartTime: slot.localStartTime,
          runMode: slot.runMode,
          attachRunId: slot.attachRunId,
        })),
        autoCreateRun,
        start: scheduleStartPayload(start),
        notes,
        compositionOverrideEnabled: false,
        desiredTankCountOverride: null,
        desiredHealerCountOverride: null,
        desiredDpsCountOverride: null,
        desiredLootbuddyCountOverride: null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      resetForm();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setOpenKey((key) => key + 1);
          setOpen(true);
        }}
        className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
      >
        Add times
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submit}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
          >
            <h2 className="text-base font-semibold">Add times</h2>
            <p className="mt-1 text-xs text-muted">
              Add weekly times to <span className="font-medium text-foreground">{runSetupName}</span>. Saving only
              plans the times — weekly Drafts are created at the Monday 12:00 release (or via Create Run).
            </p>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Weekly times</span>
                  <button
                    type="button"
                    disabled={slots.length >= MAX_SLOTS_PER_PLAN}
                    onClick={() => setSlots((current) => [...current, newSlotRow()])}
                    className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    Add slot
                  </button>
                </div>
                {slots.map((slot, index) => (
                  <div key={slot.key} className="flex flex-wrap items-end gap-2">
                    <label className="grid min-w-[8rem] flex-1 gap-1 text-sm">
                      <span className="text-xs text-muted">Weekday</span>
                      <select
                        value={slot.weekday}
                        onChange={(event) => {
                          const weekday = event.target.value as (typeof COMMUNITY_WEEKDAYS)[number];
                          setSlots((current) =>
                            current.map((row) => (row.key === slot.key ? { ...row, weekday } : row)),
                          );
                        }}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      >
                        {COMMUNITY_WEEKDAYS.map((day) => (
                          <option key={day} value={day}>
                            {WEEKDAY_LABELS[day]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid min-w-[7rem] flex-1 gap-1 text-sm">
                      <span className="text-xs text-muted">Time</span>
                      <input
                        type="time"
                        required
                        value={slot.localStartTime}
                        onChange={(event) => {
                          const localStartTime = event.target.value;
                          setSlots((current) =>
                            current.map((row) => (row.key === slot.key ? { ...row, localStartTime } : row)),
                          );
                        }}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid min-w-[7rem] flex-1 gap-1 text-sm">
                      <span className="text-xs text-muted">Mode</span>
                      <select
                        value={slot.runMode}
                        onChange={(event) => {
                          const runMode = event.target.value as CommunityScheduleRunMode;
                          setSlots((current) =>
                            current.map((row) => (row.key === slot.key ? { ...row, runMode } : row)),
                          );
                        }}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      >
                        {COMMUNITY_SCHEDULE_RUN_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {COMMUNITY_SCHEDULE_RUN_MODE_LABELS[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={slots.length <= 1}
                      onClick={() => setSlots((current) => current.filter((row) => row.key !== slot.key))}
                      className="mb-0.5 inline-flex h-9 items-center rounded-md border border-border px-2 text-xs disabled:opacity-40"
                      aria-label={`Remove slot ${index + 1}`}
                    >
                      Remove
                    </button>
                    <FirstOccurrenceField
                      candidates={candidates}
                      unavailableRunIds={chosenRunIds}
                      value={slot.attachRunId}
                      onChange={(candidate) => chooseFirstOccurrence(slot.key, candidate)}
                      loadError={loadError}
                    />
                  </div>
                ))}
                {chosenRunIds.size > 0 ? (
                  <p className="text-[11px] text-muted">
                    Existing Runs are used as first occurrences only — they are never changed. Run Setup and Raid Lead
                    stay those of {runSetupName}.
                  </p>
                ) : null}
              </div>

              <ScheduleStartField value={start} onChange={setStart} />

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateRun}
                  onChange={(event) => setAutoCreateRun(event.target.checked)}
                />
                <span>Automatically create weekly Draft — Draft release: Monday 12:00 (Europe/Berlin)</span>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  maxLength={500}
                  className="rounded-md border border-border bg-surface-raised px-2 py-1"
                />
              </label>
            </div>

            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black disabled:opacity-60"
              >
                {pending ? "Saving…" : "Add times"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
