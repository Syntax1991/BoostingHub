"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRunTemplateAction, updateRunTemplateAction } from "@/controllers/run-template.actions";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";

type FormMode = "create" | "edit";

type RaidOption = { id: string; name: string; season: string; totalBossCount: number };
type RaidLeadOption = { id: string; name: string };

export type RunTemplateFormValues = {
  templateId?: string;
  name: string;
  raidId: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  plannedBossCount: number;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  notes: string | null;
  raidLeadId: string;
};

function emptyValues(raids: RaidOption[], raidLeads: RaidLeadOption[], defaultRaidLeadId: string): RunTemplateFormValues {
  return {
    name: "",
    raidId: raids[0]?.id ?? "",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: raids[0]?.totalBossCount ?? 1,
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    raidLeadId: defaultRaidLeadId,
  };
}

export function RunTemplateFormDialog({
  mode,
  initial,
  raids,
  raidLeads,
  canAssignRaidLead,
  defaultRaidLeadId,
  triggerLabel,
  triggerClassName,
}: {
  mode: FormMode;
  initial?: RunTemplateFormValues;
  raids: RaidOption[];
  raidLeads: RaidLeadOption[];
  canAssignRaidLead: boolean;
  defaultRaidLeadId: string;
  triggerLabel: string;
  triggerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const initialValues = useMemo(
    () => initial ?? emptyValues(raids, raidLeads, defaultRaidLeadId),
    [initial, raids, raidLeads, defaultRaidLeadId],
  );
  const [values, setValues] = useState<RunTemplateFormValues>(initialValues);

  const selectedRaid = raids.find((raid) => raid.id === values.raidId) ?? null;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setSuccess(null);
      setValues(initialValues);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, initialValues]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function update(patch: Partial<RunTemplateFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function submit(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const payload = {
        name: values.name,
        raidId: values.raidId,
        difficulty: values.difficulty,
        lootType: values.lootType,
        plannedBossCount: values.plannedBossCount,
        desiredTankCount: values.desiredTankCount,
        desiredHealerCount: values.desiredHealerCount,
        desiredDpsCount: values.desiredDpsCount,
        notes: values.notes,
        // Always sent explicitly (never omitted): the Service requires an
        // ADMIN actor to name a target owner even when that target is the
        // ADMIN's own self-service template.
        raidLeadId: canAssignRaidLead ? values.raidLeadId : defaultRaidLeadId,
      };
      const result =
        mode === "create"
          ? await createRunTemplateAction(payload)
          : await updateRunTemplateAction({ ...payload, templateId: values.templateId });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
      close();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValues(initialValues);
          setError(null);
          setSuccess(null);
          setOpen(true);
        }}
        className={
          triggerClassName ??
          "inline-flex h-8 items-center rounded-md bg-accent px-2 text-xs font-medium text-black hover:bg-[#d8b436]"
        }
      >
        {triggerLabel}
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="w-[min(100%,32rem)] max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground backdrop:bg-black/60"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {mode === "create" ? "New Run Template" : "Edit Run Template"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Stores planning defaults only — raid, difficulty, loot type, planned bosses, composition, and notes.
              Schedule and status are always set per Run.
            </p>
          </div>
          <form className="space-y-3 px-4 py-4" onSubmit={submit}>
            {error ? (
              <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}
            {success ? (
              <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                {success}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Name</span>
              <input
                value={values.name}
                onChange={(event) => update({ name: event.target.value })}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            {canAssignRaidLead ? (
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Raid lead</span>
                <select
                  value={values.raidLeadId}
                  onChange={(event) => update({ raidLeadId: event.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {raidLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Raid</span>
              <select
                value={values.raidId}
                onChange={(event) => {
                  const raid = raids.find((candidate) => candidate.id === event.target.value);
                  update({
                    raidId: event.target.value,
                    plannedBossCount: raid ? Math.min(values.plannedBossCount, raid.totalBossCount) : values.plannedBossCount,
                  });
                }}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {raids.map((raid) => (
                  <option key={raid.id} value={raid.id}>
                    {raid.name} ({raid.season})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Difficulty</span>
                <select
                  value={values.difficulty}
                  onChange={(event) => update({ difficulty: event.target.value as RaidDifficulty })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {RAID_DIFFICULTIES.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {DIFFICULTY_LABELS[difficulty]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Loot type</span>
                <select
                  value={values.lootType}
                  onChange={(event) => update({ lootType: event.target.value as RunLootType })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {RUN_LOOT_TYPES.map((lootType) => (
                    <option key={lootType} value={lootType}>
                      {RUN_LOOT_TYPE_LABELS[lootType]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">
                Planned bosses {selectedRaid ? `(max ${selectedRaid.totalBossCount})` : ""}
              </span>
              <input
                type="number"
                min={1}
                max={selectedRaid?.totalBossCount ?? undefined}
                value={values.plannedBossCount}
                onChange={(event) => update({ plannedBossCount: Number(event.target.value) })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Tanks</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredTankCount}
                  onChange={(event) => update({ desiredTankCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Healers</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredHealerCount}
                  onChange={(event) => update({ desiredHealerCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">DPS</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredDpsCount}
                  onChange={(event) => update({ desiredDpsCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Notes</span>
              <textarea
                value={values.notes ?? ""}
                onChange={(event) => update({ notes: event.target.value })}
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
              />
            </label>

            <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !values.name.trim() || !values.raidId}>
                {pending ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
