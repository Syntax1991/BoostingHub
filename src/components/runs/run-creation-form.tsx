"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManyRunsAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS, ROLE_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { buildRunTitle } from "@/lib/run-title";
import { isLootTypeAllowedForDifficulty } from "@/services/run-state";
import { RAID_DIFFICULTIES, RUN_LOOT_TYPES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import type { CreateManyRunsForm } from "@/services/run.service";

type RowOverrides = {
  raidId?: string;
  difficulty?: RaidDifficulty;
  lootType?: RunLootType;
  raidLeadId?: string;
  /** Present (even "") means "override"; absent means "inherit shared notes". */
  notes?: string;
  desiredTankCount?: number;
  desiredHealerCount?: number;
  desiredDpsCount?: number;
  plannedBossCount?: number;
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

export function RunCreationForm({ form }: { form: CreateManyRunsForm }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Shared defaults.
  const [raidId, setRaidId] = useState(form.raids[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(form.defaults.difficulty);
  const [lootType, setLootType] = useState<RunLootType>(form.defaults.lootType);
  const [raidLeadId, setRaidLeadId] = useState(form.defaultRaidLeadId);
  const [notes, setNotes] = useState("");
  const [desiredTankCount, setDesiredTankCount] = useState(form.defaults.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(form.defaults.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(form.defaults.desiredDpsCount);

  const sharedRaid = form.raids.find((raid) => raid.id === raidId) ?? form.raids[0] ?? null;
  const [plannedBossCount, setPlannedBossCount] = useState(sharedRaid?.totalBossCount ?? 1);

  const [rows, setRows] = useState<Row[]>([
    { key: crypto.randomUUID(), scheduledLocal: toDatetimeLocalValue(form.defaults.scheduledStartAt), overrides: {}, expanded: false },
  ]);

  function selectSharedRaid(nextRaidId: string) {
    setRaidId(nextRaidId);
    const raid = form.raids.find((candidate) => candidate.id === nextRaidId);
    setPlannedBossCount(raid?.totalBossCount ?? 1);
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

  function effectiveRaidId(row: Row) {
    return row.overrides.raidId ?? raidId;
  }
  function effectiveRaid(row: Row) {
    return form.raids.find((raid) => raid.id === effectiveRaidId(row)) ?? sharedRaid;
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
  function effectivePlannedBossCount(row: Row) {
    return row.overrides.plannedBossCount ?? plannedBossCount;
  }

  function previewTitle(row: Row) {
    try {
      const raid = effectiveRaid(row);
      return buildRunTitle({
        scheduledStartAt: fromDatetimeLocalValue(row.scheduledLocal),
        difficulty: effectiveDifficulty(row),
        lootType: effectiveLootType(row),
        plannedBossCount: effectivePlannedBossCount(row),
        totalBossCount: raid?.totalBossCount ?? 1,
        raidLeadName: effectiveRaidLeadName(row) || "TBD",
      });
    } catch {
      return "—";
    }
  }

  function selectRowRaid(row: Row, nextRaidId: string) {
    const raid = form.raids.find((candidate) => candidate.id === nextRaidId);
    updateOverrides(row.key, { raidId: nextRaidId, plannedBossCount: raid?.totalBossCount ?? 1 });
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
        scheduledLocal: last ? nextDefaultLocal(last.scheduledLocal) : toDatetimeLocalValue(form.defaults.scheduledStartAt),
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
      const copy: Row = { key: crypto.randomUUID(), scheduledLocal: source.scheduledLocal, overrides: { ...source.overrides }, expanded: false };
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
          raidId,
          difficulty,
          lootType,
          raidLeadId: form.canAssignRaidLead ? raidLeadId : undefined,
          notes: notes.trim() || undefined,
          desiredTankCount,
          desiredHealerCount,
          desiredDpsCount,
          plannedBossCount,
        },
        runs: rows.map((row, index) => ({
          scheduledStartAt: scheduledByRow[index],
          overrides: Object.keys(row.overrides).length > 0 ? row.overrides : undefined,
        })),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/manage/runs?massCreated=${result.runIds.length}`);
      router.refresh();
    });
  }

  const canSubmit = form.raids.length > 0 && rows.length >= 1 && rows.length <= form.maxRuns;

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error ? (
        <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {form.raids.length === 0 ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          No raid content is available. Reference raids could not be loaded.
        </p>
      ) : null}

      <Card>
        <CardHeader title="Shared defaults" description="Applied to every run below unless a row overrides it." />
        <div className="space-y-3 px-4 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Raid</span>
            <select
              aria-label="Shared raid"
              value={raidId}
              onChange={(event) => selectSharedRaid(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              required
            >
              {form.raids.map((raid) => (
                <option key={raid.id} value={raid.id}>
                  {raid.name} · {raid.season}
                </option>
              ))}
            </select>
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
            <span className="mb-1 block text-muted">Planned bosses</span>
            <input
              type="number"
              min={1}
              max={sharedRaid?.totalBossCount ?? 1}
              value={plannedBossCount}
              onChange={(event) => setPlannedBossCount(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              aria-label="Shared planned bosses"
            />
            <span className="mt-1 block text-xs text-muted">Out of {sharedRaid?.totalBossCount ?? 1} total bosses in this raid.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Raid Lead</span>
            {form.canAssignRaidLead ? (
              <select
                aria-label="Shared raid lead"
                value={raidLeadId}
                onChange={(event) => setRaidLeadId(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {form.raidLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} ({ROLE_LABELS[lead.accountRole]})
                  </option>
                ))}
              </select>
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
            const raid = effectiveRaid(row);
            const hasOverrides = Object.keys(row.overrides).length > 0;
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
                  <span className="text-sm">{raid?.name ?? "—"}</span>
                  <span className="text-sm text-muted">{DIFFICULTY_LABELS[effectiveDifficulty(row)]}</span>
                  <span className="text-sm text-muted">{RUN_LOOT_TYPE_LABELS[effectiveLootType(row)]}</span>
                  <span className="text-sm text-muted">{effectiveRaidLeadName(row) || "—"}</span>
                  {hasOverrides ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">Overridden</span>
                  ) : null}
                  <div className="ml-auto flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => updateRow(row.key, { expanded: !row.expanded })}>
                      {row.expanded ? "Hide" : "Configure"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => duplicateRow(row.key)} disabled={rows.length >= form.maxRuns}>
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
                    <OverrideField label="Raid" active={row.overrides.raidId !== undefined} onReset={() => resetOverride(row.key, "raidId")}>
                      <select
                        aria-label={`Run ${index + 1} raid override`}
                        value={effectiveRaidId(row)}
                        onChange={(event) => selectRowRaid(row, event.target.value)}
                        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                      >
                        {form.raids.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} · {candidate.season}
                          </option>
                        ))}
                      </select>
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
                          onChange={(event) => updateOverrides(row.key, { lootType: event.target.value as RunLootType })}
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        >
                          {RUN_LOOT_TYPES.map((value) => (
                            <option key={value} value={value} disabled={!isLootTypeAllowedForDifficulty(effectiveDifficulty(row), value)}>
                              {RUN_LOOT_TYPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </OverrideField>
                    </div>

                    <OverrideField
                      label="Planned bosses"
                      active={row.overrides.plannedBossCount !== undefined}
                      onReset={() => resetOverride(row.key, "plannedBossCount")}
                    >
                      <input
                        type="number"
                        min={1}
                        max={raid?.totalBossCount ?? 1}
                        value={effectivePlannedBossCount(row)}
                        onChange={(event) => updateOverrides(row.key, { plannedBossCount: Number(event.target.value) })}
                        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        aria-label={`Run ${index + 1} planned bosses override`}
                      />
                    </OverrideField>

                    {form.canAssignRaidLead ? (
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
                          onChange={(event) => updateOverrides(row.key, { desiredTankCount: Number(event.target.value) })}
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
                          onChange={(event) => updateOverrides(row.key, { desiredHealerCount: Number(event.target.value) })}
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
                          onChange={(event) => updateOverrides(row.key, { desiredDpsCount: Number(event.target.value) })}
                          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                          aria-label={`Run ${index + 1} desired DPS override`}
                        />
                      </OverrideField>
                    </div>

                    <OverrideField label="Notes" active={row.overrides.notes !== undefined} onReset={() => resetOverride(row.key, "notes")}>
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
        <Button type="button" variant="secondary" onClick={() => router.push("/manage/runs")}>
          Back
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
