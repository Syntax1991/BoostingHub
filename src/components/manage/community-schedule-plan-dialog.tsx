"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DEFAULT_SCHEDULE_START,
  FirstOccurrenceField,
  ScheduleStartField,
  scheduleStartPayload,
  useAdoptionCandidates,
  type ScheduleStartState,
} from "@/components/manage/community-schedule-start-fields";
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
import type { AdoptionCandidate } from "@/services/community-schedule-occurrence.service";
import { pruneUnavailableRuns } from "@/lib/community-schedule-form";

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
  /** Increments per opening, so the existing-Run list is always loaded fresh. */
  const [openKey, setOpenKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [raidLeadId, setRaidLeadId] = useState(defaultRaidLeadId ?? raidLeads[0]?.id ?? "");
  const [setupMode, setSetupMode] = useState<"existing" | "create">("existing");
  /** Explicit choice of a different Run Setup than the one adopted from the existing first-occurrence Run. */
  const [overrideAdoptedSetup, setOverrideAdoptedSetup] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [autoCreateRun, setAutoCreateRun] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([newSlotRow()]);
  const [start, setStart] = useState<ScheduleStartState>(DEFAULT_SCHEDULE_START);
  /**
   * Schedule source. "run": a basis Run defines the new Schedule (Run Setup,
   * initial Raid Lead, first weekly time, first occurrence) — derived on the
   * server from basisRunId. "setup": the normal Run Setup workflow.
   */
  const [scheduleSource, setScheduleSource] = useState<"setup" | "run">("setup");
  const [basisRunId, setBasisRunId] = useState<string | null>(null);
  /** Future-occurrence values of the basis time (start as the basis Run's weekday / time). */
  const [basisWeekday, setBasisWeekday] = useState<(typeof COMMUNITY_WEEKDAYS)[number]>("FRIDAY");
  const [basisTime, setBasisTime] = useState("20:00");
  const [basisRunMode, setBasisRunMode] = useState<CommunityScheduleRunMode>("INHOUSE");
  const { candidates, loadError } = useAdoptionCandidates(
    start,
    (available) => {
      // Drop only choices the server no longer lists (e.g. a later Starts, attached
      // meanwhile) — the basis and each time's Run independently.
      setBasisRunId((current) => pruneUnavailableRuns({ basisRunId: current, slots: [] }, available).basisRunId);
      setSlots((current) => pruneUnavailableRuns({ basisRunId: null, slots: current }, available).slots as SlotRow[]);
    },
    open ? openKey : null,
  );
  const byBasis = scheduleSource === "run";
  const basis = byBasis && basisRunId ? (candidates.find((candidate) => candidate.runId === basisRunId) ?? null) : null;
  /** Run Setup comes from the basis Run (resolved by the server) unless explicitly overridden. */
  const adoptSetup = byBasis && !overrideAdoptedSetup;
  const chosenRunIds = new Set([
    ...(byBasis && basisRunId ? [basisRunId] : []),
    ...slots.flatMap((row) => (row.attachRunId ? [row.attachRunId] : [])),
  ]);
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

  /**
   * The basis Run of a new Schedule: its eligible Raid Lead and weekday / time
   * (Europe/Berlin) become the initial values; the Run Setup follows it on the
   * server. All stay editable for FUTURE occurrences — the Run itself is never
   * changed.
   */
  function chooseBasis(candidate: AdoptionCandidate | null) {
    setError(null);
    setBasisRunId(candidate?.runId ?? null);
    if (!candidate) return;
    setRaidLeadId(candidate.raidLeadId ?? "");
    setBasisWeekday(candidate.weekday);
    setBasisTime(candidate.localStartTime);
    setOverrideAdoptedSetup(false);
  }

  function chooseSource(next: "setup" | "run") {
    setError(null);
    setScheduleSource(next);
    setBasisRunId(null);
    setOverrideAdoptedSetup(false);
    // A basis Run brings its own first time; further times are optional.
    setSlots(next === "run" ? [] : [newSlotRow()]);
  }

  /**
   * First occurrence of one additional weekly time: an existing Run only
   * satisfies that occurrence (its weekday / time are taken over) — it never
   * redefines the Schedule.
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
    setOverrideAdoptedSetup(false);
    setScheduleSource("setup");
    setBasisRunId(null);
    setBasisRunMode("INHOUSE");
    setStart(DEFAULT_SCHEDULE_START);
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
    if (byBasis && !basisRunId) {
      setError("Choose an existing Run as the Schedule source.");
      return;
    }
    const composition = {
      compositionOverrideEnabled: !useDefaults,
      desiredTankCountOverride: useDefaults ? null : overrideTanks,
      desiredHealerCountOverride: useDefaults ? null : overrideHealers,
      desiredDpsCountOverride: useDefaults ? null : overrideDps,
      desiredLootbuddyCountOverride: useDefaults ? null : overrideLootbuddies,
    };
    const slotPayload = slots.map((slot) => ({
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      runMode: slot.runMode,
      attachRunId: slot.attachRunId,
    }));
    const runSetupPayload =
      setupMode === "existing"
        ? { mode: "existing" as const, templateId }
        : {
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
          };
    const common = {
      slots: slotPayload,
      autoCreateRun,
      start: scheduleStartPayload(start),
      notes: planNotes,
      ...composition,
    };
    const payload = byBasis
      ? {
          // basisRunId is authoritative: the server derives the Run Setup, Raid
          // Lead and first weekly time. Only values the user changed are sent,
          // as overrides for FUTURE occurrences.
          scheduleSource: "run" as const,
          basisRunId,
          basisWeekday: !basis || basisWeekday !== basis.weekday ? basisWeekday : undefined,
          basisLocalStartTime: !basis || basisTime !== basis.localStartTime ? basisTime : undefined,
          basisRunMode,
          raidLeadId: raidLeadId && raidLeadId !== basis?.raidLeadId ? raidLeadId : undefined,
          runSetup: adoptSetup ? undefined : runSetupPayload,
          ...common,
        }
      : { scheduleSource: "setup" as const, raidLeadId, runSetup: runSetupPayload, ...common };

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
          setOpenKey((key) => key + 1);
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
              Base a Schedule on a Run Setup or on an existing Run, with one or more weekly times (Europe/Berlin).
              Saving only plans the times. With
              weekly Drafts on, each raid ID&apos;s Draft Runs are created on Monday 12:00 before its Wednesday reset;
              use Create Run for an earlier one.
            </p>

            <div className="mt-4 grid gap-3">
              <fieldset className="grid gap-1">
                <legend className="text-xs text-muted">Schedule source</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="scheduleSource"
                      checked={scheduleSource === "setup"}
                      onChange={() => chooseSource("setup")}
                    />
                    Run Setup
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="scheduleSource"
                      checked={scheduleSource === "run"}
                      onChange={() => chooseSource("run")}
                    />
                    Existing Run
                  </label>
                </div>
              </fieldset>

              {byBasis ? (
                <div className="grid gap-2 rounded-md border border-border p-3">
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs text-muted">Existing Run</span>
                    <select
                      required
                      aria-label="Basis Run"
                      value={basisRunId ?? ""}
                      onChange={(event) =>
                        chooseBasis(candidates.find((candidate) => candidate.runId === event.target.value) ?? null)
                      }
                      className="h-9 rounded-md border border-border bg-surface-raised px-2"
                    >
                      <option value="">Select a Run…</option>
                      {candidates
                        .filter((candidate) => candidate.runId === basisRunId || !chosenRunIds.has(candidate.runId))
                        .map((candidate) => (
                          <option key={candidate.runId} value={candidate.runId}>
                            {candidate.label}
                          </option>
                        ))}
                    </select>
                    {loadError ? <span className="text-[11px] text-danger">{loadError}</span> : null}
                    {!loadError && candidates.length === 0 ? (
                      <span className="text-[11px] text-muted">
                        No eligible Run (upcoming, not linked to a schedule, on/after the chosen start).
                      </span>
                    ) : null}
                  </label>
                  {basisRunId ? (
                    <>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid min-w-[8rem] flex-1 gap-1 text-sm">
                          <span className="text-xs text-muted">Weekly time</span>
                          <select
                            aria-label="Basis weekday"
                            value={basisWeekday}
                            onChange={(event) =>
                              setBasisWeekday(event.target.value as (typeof COMMUNITY_WEEKDAYS)[number])
                            }
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
                            aria-label="Basis time"
                            value={basisTime}
                            onChange={(event) => setBasisTime(event.target.value)}
                            className="h-9 rounded-md border border-border bg-surface-raised px-2"
                          />
                        </label>
                        <label className="grid min-w-[7rem] flex-1 gap-1 text-sm">
                          <span className="text-xs text-muted">Mode</span>
                          <select
                            value={basisRunMode}
                            onChange={(event) => setBasisRunMode(event.target.value as CommunityScheduleRunMode)}
                            className="h-9 rounded-md border border-border bg-surface-raised px-2"
                          >
                            {COMMUNITY_SCHEDULE_RUN_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {COMMUNITY_SCHEDULE_RUN_MODE_LABELS[mode]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="text-xs">
                        <span className="text-muted">First occurrence:</span> Existing Run
                        {basis ? ` · ${basis.label}` : ""}
                      </p>
                      <p className="text-[11px] text-muted">
                        The Run defines this Schedule and is its first occurrence. It is never changed — it keeps its
                        own time, Raid Lead, content and roster; the values here apply to future occurrences.
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted">Raid Lead</span>
                <select
                  required
                  value={raidLeadId}
                  onChange={(event) => {
                    setError(null);
                    setRaidLeadId(event.target.value);
                    if (setupMode === "existing" && !adoptSetup) setTemplateId("");
                  }}
                  className="h-9 rounded-md border border-border bg-surface-raised px-2"
                >
                  {raidLeadId === "" ? <option value="">Select…</option> : null}
                  {raidLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
                {basis && !basis.raidLeadId && !raidLeadId ? (
                  <span className="text-[11px] text-warning">
                    The basis Run&apos;s Raid Lead {basis.raidLeadName} is no longer eligible — choose one.
                  </span>
                ) : basis?.raidLeadId && raidLeadId === basis.raidLeadId ? (
                  <span className="text-[11px] text-muted">From the basis Run.</span>
                ) : null}
              </label>

              {adoptSetup ? (
                <div className="grid gap-1 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
                  <span className="text-xs text-muted">Run Setup</span>
                  <span className="font-medium">
                    {basis
                      ? basis.runSetup.mode === "existing"
                        ? basis.runSetup.templateName
                        : "New setup from existing Run"
                      : "From the basis Run"}
                  </span>
                  <span className="text-[11px] text-muted">
                    {basis?.runSetup.mode === "existing"
                      ? "Automatically matched from the basis Run (same content, difficulty, loot and planned composition)."
                      : basis
                        ? `Will be created when the Schedule is saved ("${basis.runSetup.templateName}", copied once from the Run's content, difficulty, loot and planned composition).`
                        : "Select a Run — its Run Setup is used automatically."}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setOverrideAdoptedSetup(true);
                    }}
                    className="justify-self-start text-xs font-medium text-accent hover:underline"
                  >
                    Use a different Run Setup for future occurrences
                  </button>
                </div>
              ) : (
              <fieldset className="grid gap-2">
                <legend className="text-xs text-muted">Run Setup</legend>
                {byBasis ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setOverrideAdoptedSetup(false);
                    }}
                    className="justify-self-start text-xs font-medium text-accent hover:underline"
                  >
                    Use the setup from the basis Run
                  </button>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="setupMode"
                    checked={setupMode === "existing"}
                    onChange={() => {
                      setError(null);
                      setSetupMode("existing");
                    }}
                  />
                  Use existing
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="setupMode"
                    checked={setupMode === "create"}
                    onChange={() => {
                      setError(null);
                      setSetupMode("create");
                    }}
                  />
                  Create new
                </label>
              </fieldset>
              )}

              {adoptSetup ? null : setupMode === "existing" ? (
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted">Existing Run Setup</span>
                  <select
                    required
                    value={templateId}
                    onChange={(event) => {
                      setError(null);
                      setTemplateId(event.target.value);
                    }}
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
                  <span className="text-xs text-muted">{byBasis ? "Additional weekly times (optional)" : "Weekly times"}</span>
                  <button
                    type="button"
                    disabled={slots.length + (byBasis ? 1 : 0) >= MAX_SLOTS_PER_PLAN}
                    onClick={() => setSlots((current) => [...current, newSlotRow()])}
                    className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {byBasis ? "Add another time" : "Add slot"}
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
                      disabled={!byBasis && slots.length <= 1}
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
                {slots.some((row) => row.attachRunId) ? (
                  <p className="text-[11px] text-muted">
                    An existing Run used for a time only satisfies that occurrence — it is never changed and does not
                    change this Schedule&apos;s Run Setup or Raid Lead.
                  </p>
                ) : null}
              </div>

              <ScheduleStartField value={start} onChange={setStart} />

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateRun}
                  disabled={(byBasis && !basisRunId) || (!adoptSetup && setupMode === "existing" && !templateId)}
                  onChange={(event) => setAutoCreateRun(event.target.checked)}
                />
                <span>Automatically create weekly Draft — Draft release: Monday 12:00 (Europe/Berlin)</span>
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
                    {adoptSetup
                      ? "The adopted Run Setup's composition (the Run's planned composition — never its roster)."
                      : setupMode === "existing" && selectedExisting
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
                disabled={
                  pending ||
                  !raidLeadId ||
                  (byBasis && !basisRunId) ||
                  (!adoptSetup && setupMode === "existing" && !templateId)
                }
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
