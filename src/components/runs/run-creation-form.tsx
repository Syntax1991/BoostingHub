"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManyRunsAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS, ROLE_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RunContentPresetKey } from "@/lib/run-content-presets";
import { buildRunTitle } from "@/lib/run-title";
import { runCreateSuccessPath } from "@/lib/run-routes";
import { isLootTypeAllowedForDifficulty } from "@/services/run-state";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import type { CreateManyRunsForm } from "@/services/run.service";

type RowOverrides = {
  contentPreset?: RunContentPresetKey;
  venomousPlannedBossCount?: number;
  difficulty?: RaidDifficulty;
  lootType?: RunLootType;
  raidLeadId?: string;
  /** Present (even "") means "override"; absent means "inherit shared notes". */
  notes?: string;
  desiredTankCount?: number;
  desiredHealerCount?: number;
  desiredDpsCount?: number;
};

type Row = {
  key: string;
  scheduledLocal: string;
  overrides: RowOverrides;
  expanded: boolean;
};

function nextDefaultLocal(afterLocal: string): string {
  try {
    const iso = fromDatetimeLocalValue(afterLocal);
    const next = new Date(Date.parse(iso) + 24 * 60 * 60 * 1000);
    return toDatetimeLocalValue(next.toISOString());
  } catch {
    return afterLocal;
  }
}

function presetLabel(form: CreateManyRunsForm, key: RunContentPresetKey): string {
  return form.contentPresets.find((preset) => preset.key === key)?.displayName ?? key;
}

export function RunCreationForm({ form }: { form: CreateManyRunsForm }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState("");
  const templateLocked = Boolean(templateId);
  const [contentPreset, setContentPreset] = useState<RunContentPresetKey>(
    form.defaults.contentPreset ?? "VENOMOUS_ABYSS",
  );
  const [venomousPlannedBossCount, setVenomousPlannedBossCount] = useState(
    form.defaults.venomousPlannedBossCount ?? form.venomousBossMax,
  );
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(form.defaults.difficulty);
  const [lootType, setLootType] = useState<RunLootType>(form.defaults.lootType);
  const [raidLeadId, setRaidLeadId] = useState(form.defaultRaidLeadId);
  const [notes, setNotes] = useState("");
  const [desiredTankCount, setDesiredTankCount] = useState(form.defaults.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(form.defaults.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(form.defaults.desiredDpsCount);

  const [rows, setRows] = useState<Row[]>([
    {
      key: crypto.randomUUID(),
      scheduledLocal: toDatetimeLocalValue(form.defaults.scheduledStartAt),
      overrides: {},
      expanded: false,
    },
  ]);

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    if (!nextTemplateId) return;
    const template = form.templates.find((candidate) => candidate.id === nextTemplateId);
    if (!template) return;

    setContentPreset(template.contentPreset);
    setVenomousPlannedBossCount(template.venomousPlannedBossCount);
    setDifficulty(template.difficulty);
    setLootType(template.lootType);
    setDesiredTankCount(template.desiredTankCount);
    setDesiredHealerCount(template.desiredHealerCount);
    setDesiredDpsCount(template.desiredDpsCount);
    setNotes(template.notes ?? "");
    setRaidLeadId(template.raidLeadId);
    setRows((current) =>
      current.map((row) => {
        if (row.overrides.raidLeadId === undefined) return row;
        const nextOverrides = { ...row.overrides };
        delete nextOverrides.raidLeadId;
        return { ...row, overrides: nextOverrides };
      }),
    );
  }

  function selectSharedDifficulty(nextDifficulty: RaidDifficulty) {
    setDifficulty(nextDifficulty);
    if (!isLootTypeAllowedForDifficulty(nextDifficulty, lootType)) {
      setLootType("UNSAVED");
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function updateOverrides(key: string, patch: RowOverrides) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, overrides: { ...row.overrides, ...patch } } : row)),
    );
  }

  function resetOverride(key: string, field: keyof RowOverrides) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row.overrides };
        delete next[field];
        return { ...row, overrides: next };
      }),
    );
  }

  function effectivePreset(row: Row): RunContentPresetKey {
    return row.overrides.contentPreset ?? contentPreset;
  }
  function effectiveVenomous(row: Row): number {
    return row.overrides.venomousPlannedBossCount ?? venomousPlannedBossCount;
  }
  function effectiveDifficulty(row: Row): RaidDifficulty {
    return row.overrides.difficulty ?? difficulty;
  }
  function effectiveLootType(row: Row): RunLootType {
    return row.overrides.lootType ?? lootType;
  }
  function effectiveRaidLeadId(row: Row) {
    return row.overrides.raidLeadId ?? raidLeadId;
  }
  function effectiveRaidLeadName(row: Row) {
    if (!form.canAssignRaidLead) return form.defaultRaidLeadName;
    return form.raidLeads.find((lead) => lead.id === effectiveRaidLeadId(row))?.name ?? "";
  }

  function previewTitle(row: Row) {
    try {
      return buildRunTitle({
        scheduledStartAt: fromDatetimeLocalValue(row.scheduledLocal),
        difficulty: effectiveDifficulty(row),
        lootType: effectiveLootType(row),
        plannedBossCount: effectiveVenomous(row),
        totalBossCount: form.venomousBossMax,
        raidLeadName: effectiveRaidLeadName(row) || "TBD",
      });
    } catch {
      return "—";
    }
  }

  function selectRowDifficulty(row: Row, nextDifficulty: RaidDifficulty) {
    const patch: RowOverrides = { difficulty: nextDifficulty };
    const effectiveLoot = row.overrides.lootType ?? lootType;
    if (!isLootTypeAllowedForDifficulty(nextDifficulty, effectiveLoot)) {
      patch.lootType = "UNSAVED";
    }
    updateOverrides(row.key, patch);
  }

  function addRow() {
    if (rows.length >= form.maxRuns) return;
    const last = rows[rows.length - 1];
    setRows([
      ...rows,
      {
        key: crypto.randomUUID(),
        scheduledLocal: last
          ? nextDefaultLocal(last.scheduledLocal)
          : toDatetimeLocalValue(form.defaults.scheduledStartAt),
        overrides: {},
        expanded: false,
      },
    ]);
  }

  function duplicateRow(key: string) {
    if (rows.length >= form.maxRuns) return;
    const source = rows.find((row) => row.key === key);
    if (!source) return;
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const copy: Row = {
        key: crypto.randomUUID(),
        scheduledLocal: source.scheduledLocal,
        overrides: { ...source.overrides },
        expanded: false,
      };
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function removeRow(key: string) {
    if (rows.length <= 1) return;
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);

    let scheduledByRow: string[];
    try {
      scheduledByRow = rows.map((row) => fromDatetimeLocalValue(row.scheduledLocal));
    } catch {
      setError("Enter a valid scheduled start for every run.");
      return;
    }

    startTransition(async () => {
      const result = await createManyRunsAction({
        defaults: {
          contentPreset,
          venomousPlannedBossCount,
          difficulty,
          lootType,
          raidLeadId: form.canAssignRaidLead ? raidLeadId : undefined,
          notes: notes.trim() || undefined,
          desiredTankCount,
          desiredHealerCount,
          desiredDpsCount,
        },
        runs: rows.map((row, index) => ({
          scheduledStartAt: scheduledByRow[index],
          overrides: Object.keys(row.overrides).length > 0 ? row.overrides : undefined,
        })),
        templateId: templateId || undefined,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(runCreateSuccessPath(result.runIds));
      router.refresh();
    });
  }

  const canSubmit = form.contentPresets.length > 0 && rows.length >= 1 && rows.length <= form.maxRuns;
  const sharedIsBundle = contentPreset === "MIDNIGHT_S2_BUNDLE";

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error ? (
        <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {form.contentPresets.length === 0 ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          No run products are available.
        </p>
      ) : null}

      {form.templates.length > 0 ? (
        <Card>
          <CardHeader
            title="Template"
            description="Applies a saved planning preset to Shared Defaults and locks the Raid Lead to the template's owner. Other values stay editable after applying."
          />
          <div className="px-4 py-4">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Use a template</span>
              <select
                aria-label="Run template"
                value={templateId}
                onChange={(event) => applyTemplate(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                <option value="">No template</option>
                {form.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Shared defaults" description="Applied to every run below unless a row overrides it." />
        <div className="space-y-3 px-4 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Product</span>
            <select
              aria-label="Shared product"
              value={contentPreset}
              onChange={(event) => setContentPreset(event.target.value as RunContentPresetKey)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              required
            >
              {form.contentPresets.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.displayName}
                </option>
              ))}
            </select>
          </label>
          {sharedIsBundle ? (
            <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted">
              Nymrissa 1/1 (fixed) · The Venomous Abyss selectable below
            </p>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-muted">The Venomous Abyss bosses</span>
            <input
              type="number"
              min={1}
              max={form.venomousBossMax}
              value={venomousPlannedBossCount}
              onChange={(event) => setVenomousPlannedBossCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              aria-label="Shared Venomous planned bosses"
            />
            <span className="mt-1 block text-xs text-muted">
              Out of {form.venomousBossMax} bosses in The Venomous Abyss.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Difficulty</span>
              <select
                aria-label="Shared difficulty"
                value={difficulty}
                onChange={(event) => selectSharedDifficulty(event.target.value as RaidDifficulty)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {RAID_DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {DIFFICULTY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Loot Type</span>
              <select
                aria-label="Shared loot type"
                value={lootType}
                onChange={(event) => setLootType(event.target.value as RunLootType)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {RUN_LOOT_TYPES.map((value) => (
                  <option key={value} value={value} disabled={!isLootTypeAllowedForDifficulty(difficulty, value)}>
                    {RUN_LOOT_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Raid Lead</span>
            {form.canAssignRaidLead ? (
              <>
                <select
                  aria-label="Shared raid lead"
                  value={raidLeadId}
                  onChange={(event) => setRaidLeadId(event.target.value)}
                  disabled={templateLocked}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {form.raidLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} ({ROLE_LABELS[lead.accountRole]})
                    </option>
                  ))}
                </select>
                {templateLocked ? (
                  <span className="mt-1 block text-xs text-muted">Locked to the selected template&apos;s raid lead.</span>
                ) : null}
              </>
            ) : (
              <>
                <input
                  value={form.defaultRaidLeadName}
                  disabled
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Shared raid lead"
                />
                <span className="mt-1 block text-xs text-muted">Raid leads can only create runs they lead.</span>
              </>
            )}
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Tanks</span>
              <input
                type="number"
                min={0}
                max={40}
                value={desiredTankCount}
                onChange={(event) => setDesiredTankCount(Number(event.target.value))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
                aria-label="Shared desired tanks"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Healers</span>
              <input
                type="number"
                min={0}
                max={40}
                value={desiredHealerCount}
                onChange={(event) => setDesiredHealerCount(Number(event.target.value))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
                aria-label="Shared desired healers"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">DPS</span>
              <input
                type="number"
                min={0}
                max={40}
                value={desiredDpsCount}
                onChange={(event) => setDesiredDpsCount(Number(event.target.value))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
                aria-label="Shared desired DPS"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2 py-2"
            />
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Runs (${rows.length}/${form.maxRuns})`}
          description="Each run needs its own scheduled start. Configure a row to override any shared value for just that run."
          action={
            <Button type="button" variant="secondary" onClick={addRow} disabled={rows.length >= form.maxRuns}>
              Add Run
            </Button>
          }
        />
        <ul className="divide-y divide-border">
          {rows.map((row, index) => {
            const hasOverrides = Object.keys(row.overrides).length > 0;
            const rowPreset = effectivePreset(row);
            return (
              <li key={row.key} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-6 text-xs text-muted">#{index + 1}</span>
                  <input
                    type="datetime-local"
                    value={row.scheduledLocal}
                    onChange={(event) => updateRow(row.key, { scheduledLocal: event.target.value })}
                    className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                    aria-label={`Run ${index + 1} scheduled start`}
                    required
                  />
                  <span className="text-sm">{presetLabel(form, rowPreset)}</span>
                  <span className="text-sm text-muted">
                    VA {effectiveVenomous(row)}/{form.venomousBossMax}
                  </span>
                  <span className="text-sm text-muted">{DIFFICULTY_LABELS[effectiveDifficulty(row)]}</span>
                  <span className="text-sm text-muted">{RUN_LOOT_TYPE_LABELS[effectiveLootType(row)]}</span>
                  <span className="text-sm text-muted">{effectiveRaidLeadName(row) || "—"}</span>
                  {hasOverrides ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                      Overridden
                    </span>
                  ) : null}
                  <div className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => updateRow(row.key, { expanded: !row.expanded })}
                    >
                      {row.expanded ? "Hide" : "Configure"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => duplicateRow(row.key)}
                      disabled={rows.length >= form.maxRuns}
                    >
                      Duplicate
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => removeRow(row.key)} disabled={rows.length <= 1}>
                      Remove
                    </Button>
                  </div>
                </div>
                <p className="mt-1 pl-9 text-xs text-muted">{previewTitle(row)}</p>

                {row.expanded ? (
                  <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-raised p-3">
                    <OverrideField
                      label="Product"
                      active={row.overrides.contentPreset !== undefined}
                      onReset={() => resetOverride(row.key, "contentPreset")}
                    >
                      <select
                        aria-label={`Run ${index + 1} product override`}
                        value={rowPreset}
                        onChange={(event) =>
                          updateOverrides(row.key, {
                            contentPreset: event.target.value as RunContentPresetKey,
                          })
                        }
                        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                      >
                        {form.contentPresets.map((preset) => (
                          <option key={preset.key} value={preset.key}>
                            {preset.displayName}
                          </option>
                        ))}
                      </select>
                    </OverrideField>

                    {rowPreset === "MIDNIGHT_S2_BUNDLE" ? (
                      <p className="text-xs text-muted">Nymrissa 1/1 is fixed for the Season 2 Bundle.</p>
                    ) : null}

                    <OverrideField
                      label="Venomous bosses"
                      active={row.overrides.venomousPlannedBossCount !== undefined}
                      onReset={() => resetOverride(row.key, "venomousPlannedBossCount")}
                    >
                      <input
                        type="number"
                        min={1}
                        max={form.venomousBossMax}
                        value={effectiveVenomous(row)}
                        onChange={(event) =>
                          updateOverrides(row.key, {
                            venomousPlannedBossCount: Number(event.target.value),
                          })
                        }
                        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        aria-label={`Run ${index + 1} Venomous bosses override`}
                      />
                    </OverrideField>

                    <div className="grid grid-cols-2 gap-2">
                      <OverrideField
                        label="Difficulty"
                        active={row.overrides.difficulty !== undefined}
                        onReset={() => resetOverride(row.key, "difficulty")}
                      >
                        <select
                          aria-label={`Run ${index + 1} difficulty override`}
                          value={effectiveDifficulty(row)}
                          onChange={(event) => selectRowDifficulty(row, event.target.value as RaidDifficulty)}
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        >
                          {RAID_DIFFICULTIES.map((value) => (
                            <option key={value} value={value}>
                              {DIFFICULTY_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </OverrideField>
                      <OverrideField
                        label="Loot Type"
                        active={row.overrides.lootType !== undefined}
                        onReset={() => resetOverride(row.key, "lootType")}
                      >
                        <select
                          aria-label={`Run ${index + 1} loot type override`}
                          value={effectiveLootType(row)}
                          onChange={(event) =>
                            updateOverrides(row.key, { lootType: event.target.value as RunLootType })
                          }
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        >
                          {RUN_LOOT_TYPES.map((value) => (
                            <option
                              key={value}
                              value={value}
                              disabled={!isLootTypeAllowedForDifficulty(effectiveDifficulty(row), value)}
                            >
                              {RUN_LOOT_TYPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </OverrideField>
                    </div>

                    {form.canAssignRaidLead && !templateLocked ? (
                      <OverrideField
                        label="Raid Lead"
                        active={row.overrides.raidLeadId !== undefined}
                        onReset={() => resetOverride(row.key, "raidLeadId")}
                      >
                        <select
                          aria-label={`Run ${index + 1} raid lead override`}
                          value={effectiveRaidLeadId(row)}
                          onChange={(event) => updateOverrides(row.key, { raidLeadId: event.target.value })}
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        >
                          {form.raidLeads.map((lead) => (
                            <option key={lead.id} value={lead.id}>
                              {lead.name} ({ROLE_LABELS[lead.accountRole]})
                            </option>
                          ))}
                        </select>
                      </OverrideField>
                    ) : null}

                    <div className="grid grid-cols-3 gap-2">
                      <OverrideField
                        label="Tanks"
                        active={row.overrides.desiredTankCount !== undefined}
                        onReset={() => resetOverride(row.key, "desiredTankCount")}
                      >
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={row.overrides.desiredTankCount ?? desiredTankCount}
                          onChange={(event) =>
                            updateOverrides(row.key, { desiredTankCount: Number(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                          aria-label={`Run ${index + 1} desired tanks override`}
                        />
                      </OverrideField>
                      <OverrideField
                        label="Healers"
                        active={row.overrides.desiredHealerCount !== undefined}
                        onReset={() => resetOverride(row.key, "desiredHealerCount")}
                      >
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={row.overrides.desiredHealerCount ?? desiredHealerCount}
                          onChange={(event) =>
                            updateOverrides(row.key, { desiredHealerCount: Number(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                          aria-label={`Run ${index + 1} desired healers override`}
                        />
                      </OverrideField>
                      <OverrideField
                        label="DPS"
                        active={row.overrides.desiredDpsCount !== undefined}
                        onReset={() => resetOverride(row.key, "desiredDpsCount")}
                      >
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={row.overrides.desiredDpsCount ?? desiredDpsCount}
                          onChange={(event) =>
                            updateOverrides(row.key, { desiredDpsCount: Number(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                          aria-label={`Run ${index + 1} desired DPS override`}
                        />
                      </OverrideField>
                    </div>

                    <OverrideField
                      label="Notes"
                      active={row.overrides.notes !== undefined}
                      onReset={() => resetOverride(row.key, "notes")}
                    >
                      <textarea
                        value={row.overrides.notes ?? notes}
                        onChange={(event) => updateOverrides(row.key, { notes: event.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm"
                        aria-label={`Run ${index + 1} notes override`}
                      />
                    </OverrideField>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/runs")}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? "Creating…" : `Create ${rows.length} Draft${rows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}

function OverrideField({
  label,
  active,
  onReset,
  children,
}: {
  label: string;
  active: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center justify-between gap-2">
        <span className="text-muted">{label}</span>
        {active ? (
          <button type="button" onClick={onReset} className="text-xs text-accent hover:underline">
            Use shared
          </button>
        ) : (
          <span className="text-xs text-muted">Inherited</span>
        )}
      </span>
      {children}
    </label>
  );
}
