"use client";

import { useMemo, useState, useTransition } from "react";
import { COMMUNITY_WEEKDAYS } from "@/models/enums";
import {
  createCommunityScheduleSlotAction,
  updateCommunityScheduleSlotAction,
} from "@/controllers/community-schedule.actions";
import type { CommunityScheduleTemplateOption } from "@/services/community-schedule.service";

const WEEKDAY_LABELS: Record<(typeof COMMUNITY_WEEKDAYS)[number], string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

type RaidLeadOption = { id: string; name: string };

type CreateProps = {
  mode: "create";
  raidLeads: RaidLeadOption[];
  templates: CommunityScheduleTemplateOption[];
  defaultRaidLeadId?: string | null;
  triggerLabel?: string;
};

type EditProps = {
  mode: "edit";
  raidLeads: RaidLeadOption[];
  templates: CommunityScheduleTemplateOption[];
  initial: {
    slotId: string;
    weekday: (typeof COMMUNITY_WEEKDAYS)[number];
    localStartTime: string;
    label: string;
    notes: string | null;
    raidLeadId: string;
    runTemplateId: string | null;
    autoCreateRun: boolean;
  };
  triggerLabel?: string;
};

export function CommunityScheduleSlotFormDialog(props: CreateProps | EditProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [raidLeadId, setRaidLeadId] = useState(
    props.mode === "edit" ? props.initial.raidLeadId : (props.defaultRaidLeadId ?? props.raidLeads[0]?.id ?? ""),
  );
  const [runTemplateId, setRunTemplateId] = useState<string>(
    props.mode === "edit" ? (props.initial.runTemplateId ?? "") : "",
  );
  const [autoCreateRun, setAutoCreateRun] = useState(
    props.mode === "edit" ? props.initial.autoCreateRun : false,
  );

  const initial =
    props.mode === "edit"
      ? props.initial
      : {
          slotId: "",
          weekday: "FRIDAY" as const,
          localStartTime: "19:45",
          label: "",
          notes: null as string | null,
          raidLeadId: props.defaultRaidLeadId ?? props.raidLeads[0]?.id ?? "",
          runTemplateId: null as string | null,
          autoCreateRun: false,
        };

  const templatesForLead = useMemo(
    () => props.templates.filter((template) => template.raidLeadId === raidLeadId),
    [props.templates, raidLeadId],
  );

  function submit(formData: FormData) {
    setError(null);
    const payload = {
      weekday: String(formData.get("weekday") ?? ""),
      localStartTime: String(formData.get("localStartTime") ?? ""),
      label: String(formData.get("label") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      raidLeadId: String(formData.get("raidLeadId") ?? ""),
      runTemplateId: runTemplateId.trim().length > 0 ? runTemplateId : null,
      autoCreateRun,
    };
    startTransition(async () => {
      const result =
        props.mode === "create"
          ? await createCommunityScheduleSlotAction(payload)
          : await updateCommunityScheduleSlotAction({ ...payload, slotId: props.initial.slotId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          props.mode === "create"
            ? "inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
            : "inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
        }
      >
        {props.triggerLabel ?? (props.mode === "create" ? "Add Schedule Slot" : "Edit")}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            action={submit}
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl"
          >
            <h2 className="text-base font-semibold">
              {props.mode === "create" ? "Add Schedule Slot" : "Edit Schedule Slot"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Recurring wall-clock time in Europe/Berlin. Optional template links enable manual or automatic DRAFT
              run creation per raid-ID window.
            </p>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Weekday</span>
                <select
                  name="weekday"
                  defaultValue={initial.weekday}
                  required
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                >
                  {COMMUNITY_WEEKDAYS.map((day) => (
                    <option key={day} value={day}>
                      {WEEKDAY_LABELS[day]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Start time (HH:mm)</span>
                <input
                  name="localStartTime"
                  type="time"
                  required
                  defaultValue={initial.localStartTime}
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Label</span>
                <input
                  name="label"
                  required
                  maxLength={80}
                  defaultValue={initial.label}
                  placeholder="HC VIP"
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Raid Lead</span>
                <select
                  name="raidLeadId"
                  required
                  value={raidLeadId}
                  onChange={(event) => {
                    setRaidLeadId(event.target.value);
                    setRunTemplateId("");
                  }}
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                >
                  {props.raidLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Run Template (optional)</span>
                <select
                  value={runTemplateId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setRunTemplateId(next);
                    if (!next) setAutoCreateRun(false);
                  }}
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                >
                  <option value="">None</option>
                  {templatesForLead.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateRun}
                  disabled={!runTemplateId}
                  onChange={(event) => setAutoCreateRun(event.target.checked)}
                />
                <span>Auto-create DRAFT runs (hourly job)</span>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Notes (optional)</span>
                <textarea
                  name="notes"
                  maxLength={500}
                  defaultValue={initial.notes ?? ""}
                  rows={2}
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
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
