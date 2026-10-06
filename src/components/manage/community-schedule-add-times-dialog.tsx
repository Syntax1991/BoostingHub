"use client";

import { useState, useTransition } from "react";
import { COMMUNITY_WEEKDAYS } from "@/models/enums";
import { MAX_SLOTS_PER_PLAN } from "@/lib/community-schedule";
import { addCommunityScheduleTimesAction } from "@/controllers/community-schedule.actions";

const WEEKDAY_LABELS: Record<(typeof COMMUNITY_WEEKDAYS)[number], string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

type SlotRow = { key: string; weekday: (typeof COMMUNITY_WEEKDAYS)[number]; localStartTime: string };

function newSlotRow(weekday: (typeof COMMUNITY_WEEKDAYS)[number] = "FRIDAY", localStartTime = "19:45"): SlotRow {
  return { key: crypto.randomUUID(), weekday, localStartTime };
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [autoCreateRun, setAutoCreateRun] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([newSlotRow()]);
  const [notes, setNotes] = useState("");

  function resetForm() {
    setError(null);
    setAutoCreateRun(false);
    setSlots([newSlotRow()]);
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
        })),
        autoCreateRun,
        notes,
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
              Add weekly times to <span className="font-medium text-foreground">{runSetupName}</span>.
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
                    <button
                      type="button"
                      disabled={slots.length <= 1}
                      onClick={() => setSlots((current) => current.filter((row) => row.key !== slot.key))}
                      className="mb-0.5 inline-flex h-9 items-center rounded-md border border-border px-2 text-xs disabled:opacity-40"
                      aria-label={`Remove slot ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateRun}
                  onChange={(event) => setAutoCreateRun(event.target.checked)}
                />
                <span>Auto-create DRAFT runs (hourly job)</span>
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
