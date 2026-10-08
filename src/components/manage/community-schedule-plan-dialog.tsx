"use client";

import { useMemo, useState, useTransition } from "react";
import { COMMUNITY_SCHEDULE_RUN_MODES, COMMUNITY_WEEKDAYS, RAID_DIFFICULTIES, RUN_LOOT_TYPES } from "@/models/enums";
import type { CommunityScheduleRunMode, RaidDifficulty, RunLootType } from "@/models/enums";
import { MAX_SLOTS_PER_PLAN } from "@/lib/community-schedule";
import { COMMUNITY_SCHEDULE_RUN_MODE_LABELS, DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import {
  defaultContentBossCounts,
  selectionCoveragePreview,
  type PlanningProduct,
  type ProductSelection,
} from "@/lib/product-selection";
import { ProductContentPicker } from "@/components/runs/product-content-picker";
import { createCommunitySchedulePlanAction } from "@/controllers/community-schedule.actions";
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

type SlotRow = {
  key: string;
  weekday: (typeof COMMUNITY_WEEKDAYS)[number];
  localStartTime: string;
  runMode: CommunityScheduleRunMode;
};

function newSlotRow(
  weekday: (typeof COMMUNITY_WEEKDAYS)[number] = "FRIDAY",
  localStartTime = "19:45",
  runMode: CommunityScheduleRunMode = "INHOUSE",
): SlotRow {
  return { key: crypto.randomUUID(), weekday, localStartTime, runMode };
}

export function CommunitySchedulePlanDialog({
  raidLeads,
  templates,
  products,
  defaultRaidLeadId,
}: {
  raidLeads: RaidLeadOption[];
  templates: CommunityScheduleTemplateOption[];
  /** Active + selectable Products for an in-context new Run Setup. */
  products: PlanningProduct[];
  defaultRaidLeadId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [raidLeadId, setRaidLeadId] = useState(defaultRaidLeadId ?? raidLeads[0]?.id ?? "");
  const [setupMode, setSetupMode] = useState<"existing" | "create">("existing");
  const [templateId, setTemplateId] = useState("");
  const [autoCreateRun, setAutoCreateRun] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([newSlotRow()]);
  const [name, setName] = useState("");
  const initialProduct = (): ProductSelection => {
    const first = products[0];
    return { productId: first?.id ?? "", contentBossCounts: first ? defaultContentBossCounts(first) : {} };
  };
  const [product, setProduct] = useState<ProductSelection>(initialProduct);
  const [difficulty, setDifficulty] = useState<RaidDifficulty>("HEROIC");
  const [lootType, setLootType] = useState<RunLootType>("UNSAVED");
  const [desiredTankCount, setDesiredTankCount] = useState(2);
  const [desiredHealerCount, setDesiredHealerCount] = useState(4);
  const [desiredDpsCount, setDesiredDpsCount] = useState(14);
  const [desiredLootbuddyCount, setDesiredLootbuddyCount] = useState(0);
  const [templateNotes, setTemplateNotes] = useState("");
  const [planNotes, setPlanNotes] = useState("");

  const templatesForLead = useMemo(
    () => templates.filter((template) => template.usable),
    [templates],
  );
  const [useDefaults, setUseDefaults] = useState(true);
  const [overrideTanks, setOverrideTanks] = useState(2);
  const [overrideHealers, setOverrideHealers] = useState(4);
  const [overrideDps, setOverrideDps] = useState(14);
  const [overrideLootbuddies, setOverrideLootbuddies] = useState(0);
  const selectedExisting = useMemo(
    () => templatesForLead.find((template) => template.id === templateId),
    [templatesForLead, templateId],
  );

  const selectedProduct = products.find((row) => row.id === product.productId);
  const coveragePreview = selectedProduct
    ? selectionCoveragePreview(selectedProduct, product.contentBossCounts)
    : "—";

  function resetForm() {
    setError(null);
    setRaidLeadId(defaultRaidLeadId ?? raidLeads[0]?.id ?? "");
    setSetupMode(templatesForLead.length > 0 ? "existing" : "create");
    setTemplateId("");
    setAutoCreateRun(false);
    setSlots([newSlotRow()]);
    setName("");
    setProduct(initialProduct());
    setDifficulty("HEROIC");
    setLootType("UNSAVED");
    setDesiredTankCount(2);
    setDesiredHealerCount(4);
    setDesiredDpsCount(14);
    setDesiredLootbuddyCount(0);
    setTemplateNotes("");
    setPlanNotes("");
    setUseDefaults(true);
    setOverrideTanks(2);
    setOverrideHealers(4);
    setOverrideDps(14);
    setOverrideLootbuddies(0);
  }

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    const composition = {
      compositionOverrideEnabled: !useDefaults,
      desiredTankCountOverride: useDefaults ? null : overrideTanks,
      desiredHealerCountOverride: useDefaults ? null : overrideHealers,
      desiredDpsCountOverride: useDefaults ? null : overrideDps,
      desiredLootbuddyCountOverride: useDefaults ? null : overrideLootbuddies,
    };
    const payload =
      setupMode === "existing"
        ? {
            raidLeadId,
            runSetup: { mode: "existing" as const, templateId },
            slots: slots.map((slot) => ({
              weekday: slot.weekday,
              localStartTime: slot.localStartTime,
              runMode: slot.runMode,
            })),
            autoCreateRun,
            notes: planNotes,
            ...composition,
          }
        : {
            raidLeadId,
            runSetup: {
              mode: "create" as const,
              name,
              productId: product.productId,
              contentBossCounts: product.contentBossCounts,
              difficulty,
              lootType,
              desiredTankCount,
              desiredHealerCount,
              desiredDpsCount,
              desiredLootbuddyCount,
              notes: templateNotes,
            },
            slots: slots.map((slot) => ({
              weekday: slot.weekday,
              localStartTime: slot.localStartTime,
              runMode: slot.runMode,
            })),
            autoCreateRun,
            notes: planNotes,
            ...composition,
          };

    startTransition(async () => {
      const result = await createCommunitySchedulePlanAction(payload);
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
        className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
      >
        Create Schedule
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submit}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
          >
            <h2 className="text-base font-semibold">Create Schedule</h2>
            <p className="mt-1 text-xs text-muted">
              Link a Run Setup to one or more weekly times (Europe/Berlin). When Auto-create is on, CURRENT (if still
              future) and NEXT DRAFT Runs are created immediately after save; the hourly job remains a safety net.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Raid Lead</span>
                <select
                  required
                  value={raidLeadId}
                  onChange={(event) => {
                    setRaidLeadId(event.target.value);
                    setTemplateId("");
                  }}
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                >
                  {raidLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-xs text-muted">Run Setup</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="setupMode"
                    checked={setupMode === "existing"}
                    onChange={() => setSetupMode("existing")}
                  />
                  Use existing
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="setupMode"
                    checked={setupMode === "create"}
                    onChange={() => setSetupMode("create")}
                  />
                  Create new
                </label>
              </fieldset>

              {setupMode === "existing" ? (
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted">Existing Run Setup</span>
                  <select
                    required
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    className="h-9 rounded-md border border-border bg-surface-raised px-2"
                  >
                    <option value="">Select…</option>
                    {templatesForLead.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.productLabel} ·{" "}
                        {template.difficulty === "HEROIC" ? "HC" : template.difficulty} ·{" "}
                        {template.lootType}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="grid gap-3 rounded-md border border-border p-3">
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs text-muted">Name</span>
                    <input
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      className="h-9 rounded-md border border-border bg-surface-raised px-2"
                    />
                  </label>
                  <ProductContentPicker
                    products={products}
                    value={product}
                    onChange={setProduct}
                    ariaPrefix="New Run Setup"
                    compact
                  />
                  <p className="flex justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium">
                    <span>Total coverage</span>
                    <span>{coveragePreview}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">Difficulty</span>
                      <select
                        value={difficulty}
                        onChange={(event) => setDifficulty(event.target.value as RaidDifficulty)}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      >
                        {RAID_DIFFICULTIES.map((value) => (
                          <option key={value} value={value}>
                            {DIFFICULTY_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">Loot</span>
                      <select
                        value={lootType}
                        onChange={(event) => setLootType(event.target.value as RunLootType)}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      >
                        {RUN_LOOT_TYPES.map((value) => (
                          <option key={value} value={value}>
                            {RUN_LOOT_TYPE_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">Tanks</span>
                      <input
                        type="number"
                        min={0}
                        value={desiredTankCount}
                        onChange={(event) => setDesiredTankCount(Number(event.target.value))}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">Healers</span>
                      <input
                        type="number"
                        min={0}
                        value={desiredHealerCount}
                        onChange={(event) => setDesiredHealerCount(Number(event.target.value))}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">DPS</span>
                      <input
                        type="number"
                        min={0}
                        value={desiredDpsCount}
                        onChange={(event) => setDesiredDpsCount(Number(event.target.value))}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted">LB</span>
                      <input
                        type="number"
                        min={0}
                        value={desiredLootbuddyCount}
                        onChange={(event) => setDesiredLootbuddyCount(Number(event.target.value))}
                        className="h-9 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs text-muted">Setup notes (optional)</span>
                    <textarea
                      value={templateNotes}
                      onChange={(event) => setTemplateNotes(event.target.value)}
                      rows={2}
                      maxLength={500}
                      className="rounded-md border border-border bg-surface-raised px-2 py-1"
                    />
                  </label>
                </div>
              )}

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
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateRun}
                  disabled={setupMode === "existing" && !templateId}
                  onChange={(event) => setAutoCreateRun(event.target.checked)}
                />
                <span>Auto-create DRAFT runs immediately (hourly job is a safety net)</span>
              </label>

              <fieldset className="grid gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-medium text-muted">Composition</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useDefaults}
                    onChange={(event) => setUseDefaults(event.target.checked)}
                  />
                  <span>Use Run Setup defaults</span>
                </label>
                {useDefaults ? (
                  <p className="text-xs text-muted">
                    {setupMode === "existing" && selectedExisting
                      ? `${selectedExisting.desiredTankCount} Tanks · ${selectedExisting.desiredHealerCount} Healers · ${selectedExisting.desiredDpsCount} DPS · ${selectedExisting.desiredLootbuddyCount} Lootbuddy`
                      : setupMode === "create"
                        ? `${desiredTankCount} Tanks · ${desiredHealerCount} Healers · ${desiredDpsCount} DPS · ${desiredLootbuddyCount} Lootbuddy`
                        : "Select a Run Setup to see defaults."}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs">
                      <span className="text-muted">Tanks</span>
                      <input
                        type="number"
                        min={0}
                        value={overrideTanks}
                        onChange={(event) => setOverrideTanks(Number(event.target.value))}
                        className="h-8 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-muted">Healers</span>
                      <input
                        type="number"
                        min={0}
                        value={overrideHealers}
                        onChange={(event) => setOverrideHealers(Number(event.target.value))}
                        className="h-8 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-muted">DPS</span>
                      <input
                        type="number"
                        min={0}
                        value={overrideDps}
                        onChange={(event) => setOverrideDps(Number(event.target.value))}
                        className="h-8 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-muted">Lootbuddies</span>
                      <input
                        type="number"
                        min={0}
                        value={overrideLootbuddies}
                        onChange={(event) => setOverrideLootbuddies(Number(event.target.value))}
                        className="h-8 rounded-md border border-border bg-surface-raised px-2"
                      />
                    </label>
                  </div>
                )}
              </fieldset>

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Slot notes (optional, applied to all new times)</span>
                <textarea
                  value={planNotes}
                  onChange={(event) => setPlanNotes(event.target.value)}
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
                disabled={pending || (setupMode === "existing" && !templateId)}
                className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black disabled:opacity-60"
              >
                {pending ? "Saving…" : "Create Schedule"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
