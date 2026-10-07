"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRunTemplateAction, updateRunTemplateAction } from "@/controllers/run-template.actions";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import {
  titleCoverageFromPreset,
  type RunContentPresetKey,
} from "@/lib/run-content-presets";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";

type FormMode = "create" | "edit";

type ContentPresetOption = { key: RunContentPresetKey; displayName: string };
type RaidLeadOption = { id: string; name: string };

export type RunTemplateFormValues = {
  templateId?: string;
  name: string;
  contentPreset: RunContentPresetKey;
  venomousPlannedBossCount: number;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  notes: string | null;
};

function emptyValues(
  contentPresets: ContentPresetOption[],
  venomousBossMax: number,
): RunTemplateFormValues {
  return {
    name: "",
    contentPreset: contentPresets[0]?.key ?? "VENOMOUS_ABYSS",
    venomousPlannedBossCount: venomousBossMax,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    desiredLootbuddyCount: 0,
    notes: null,
  };
}

type TemplateMutationResult =
  | { ok: true; message: string; templateId?: string }
  | { ok: false; code: string; message: string };

export function RunTemplateFormDialog({
  mode,
  initial,
  contentPresets,
  venomousBossMax,
  raidLeads = [],
  canAssignRaidLead = false,
  defaultRaidLeadId = "",
  triggerLabel,
  triggerClassName,
  title,
  description,
  submitLabel,
  createAction = createRunTemplateAction,
  updateAction = updateRunTemplateAction,
}: {
  mode: FormMode;
  initial?: RunTemplateFormValues;
  contentPresets: ContentPresetOption[];
  venomousBossMax: number;
  /** @deprecated Global setups have no Raid Lead — kept optional for call-site compatibility. */
  raidLeads?: RaidLeadOption[];
  canAssignRaidLead?: boolean;
  defaultRaidLeadId?: string;
  triggerLabel: string;
  triggerClassName?: string;
  /** Override dialog heading (defaults to New/Edit Run Template). */
  title?: string;
  description?: string;
  submitLabel?: string;
  createAction?: (input: unknown) => Promise<TemplateMutationResult>;
  updateAction?: (input: unknown) => Promise<TemplateMutationResult>;
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
    () => initial ?? emptyValues(contentPresets, venomousBossMax),
    [initial, contentPresets, venomousBossMax],
  );
  const [values, setValues] = useState<RunTemplateFormValues>(initialValues);

  const isBundle = values.contentPreset === "MIDNIGHT_S2_BUNDLE";
  const coveragePreview = titleCoverageFromPreset({
    preset: values.contentPreset,
    venomousPlannedBossCount: values.venomousPlannedBossCount,
    venomousTotalBossCount: venomousBossMax,
  });

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
        contentPreset: values.contentPreset,
        venomousPlannedBossCount: values.venomousPlannedBossCount,
        difficulty: values.difficulty,
        lootType: values.lootType,
        desiredTankCount: values.desiredTankCount,
        desiredHealerCount: values.desiredHealerCount,
        desiredDpsCount: values.desiredDpsCount,
        desiredLootbuddyCount: values.desiredLootbuddyCount,
        notes: values.notes,
      };
      void canAssignRaidLead;
      void defaultRaidLeadId;
      void raidLeads;
      const result =
        mode === "create"
          ? await createAction(payload)
          : await updateAction({ ...payload, templateId: values.templateId });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
      close();
    });
  }

  const dialogTitle = title ?? (mode === "create" ? "New Run Template" : "Edit Run Template");
  const dialogDescription =
    description ??
    "Stores planning defaults only — run content, difficulty, loot, planned bosses, composition, and notes. Schedule and status are always set per Run.";
  const dialogSubmitLabel =
    submitLabel ?? (pending ? "Saving…" : mode === "create" ? "Create template" : "Save changes");

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
          className="w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground backdrop:bg-black/60"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {dialogTitle}
            </h2>
            <p className="mt-1 text-xs text-muted">{dialogDescription}</p>
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
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Run Content</span>
              <select
                value={values.contentPreset}
                onChange={(event) =>
                  update({ contentPreset: event.target.value as RunContentPresetKey })
                }
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
                aria-label="Run Content"
              >
                {contentPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.displayName}
                  </option>
                ))}
              </select>
            </label>
            {isBundle ? (
              <div className="space-y-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span>Tidebound Grotto</span>
                  <span className="text-muted">1/1 · Included</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>The Venomous Abyss</span>
                  <span>
                    {values.venomousPlannedBossCount}/{venomousBossMax}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2 font-medium">
                  <span>Total coverage</span>
                  <span>{coveragePreview}</span>
                </div>
              </div>
            ) : null}
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
                <span className="mb-1 block text-muted">Run type</span>
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
                {isBundle ? "The Venomous Abyss bosses" : "Planned bosses"} (max {venomousBossMax})
              </span>
              <input
                type="number"
                min={1}
                max={venomousBossMax}
                value={values.venomousPlannedBossCount}
                onChange={(event) => update({ venomousPlannedBossCount: Number(event.target.value) })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
                aria-label={isBundle ? "The Venomous Abyss planned bosses" : "Planned bosses"}
              />
            </label>
            <p className="text-xs font-medium text-muted">Default composition</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Default Tanks</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredTankCount}
                  onChange={(event) => update({ desiredTankCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Default Healers</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredHealerCount}
                  onChange={(event) => update({ desiredHealerCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Default DPS</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredDpsCount}
                  onChange={(event) => update({ desiredDpsCount: Number(event.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Default Lootbuddies</span>
                <input
                  type="number"
                  min={0}
                  value={values.desiredLootbuddyCount}
                  onChange={(event) => update({ desiredLootbuddyCount: Number(event.target.value) })}
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
              <Button type="submit" disabled={pending || !values.name.trim() || contentPresets.length === 0}>
                {pending ? "Saving…" : dialogSubmitLabel}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
