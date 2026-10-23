"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  importRaidAction,
  importSeasonAction,
  previewRaidImportAction,
  previewRaidRefreshAction,
  previewSeasonImportAction,
  refreshRaidFromBlizzardAction,
} from "@/controllers/raid-catalog.actions";
import type { ActionResult } from "@/lib/action-result";
import type { RaidImportPlan, RaidImportStatus } from "@/services/raid-catalog-import-plan";
import type {
  RaidImportPreview,
  SeasonImportPreview,
} from "@/services/raid-catalog-import.service";
import {
  CheckboxField,
  Field,
  fieldInputClass,
} from "@/components/manage/raid-catalog/raid-catalog-dialog";
import { SeasonSelector } from "@/components/manage/raid-catalog/season-selector";
import { pluralize } from "@/components/manage/raid-catalog/raid-catalog-format";

/* ------------------------------------------------------------ shell */

/**
 * Two-step Blizzard dialog: fetch a preview (no writes), then apply it.
 * Native <dialog>; errors stay inline; refreshes the page after a write.
 */
function BlizzardFlowDialog({
  triggerLabel,
  triggerVariant = "secondary",
  triggerClassName = "h-9 px-3 text-sm",
  title,
  description,
  onOpen,
  children,
  footer,
  dialogRef,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
  triggerClassName?: string;
  title: string;
  description: ReactNode;
  onOpen: () => void;
  children: ReactNode;
  footer: ReactNode;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
}) {
  const titleId = useId();
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        className={triggerClassName}
        onClick={() => {
          onOpen();
          dialogRef.current?.showModal();
        }}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(40rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <div className="text-xs text-muted">{description}</div>
          {children}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
            {footer}
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Pending flag + inline error / message for one dialog's server actions. */
function useActionRunner() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run<T extends ActionResult>(action: () => Promise<T>, onOk: (result: T) => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOk(result);
    });
  }
  return { pending, error, setError, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}

/* ------------------------------------------------------------ preview */

const STATUS_LABEL: Record<RaidImportStatus, string> = {
  NEW: "New",
  UP_TO_DATE: "Already imported",
  UPDATE_AVAILABLE: "Update available",
};

export function ImportStatusBadge({ status }: { status: RaidImportStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
        status === "NEW" && "bg-accent/15 text-accent",
        status === "UP_TO_DATE" && "bg-success/15 text-success",
        status === "UPDATE_AVAILABLE" && "bg-warning/15 text-warning",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function bossCountLabel(plan: RaidImportPlan): string {
  const total = plan.bosses.length + plan.staleBosses.length;
  return pluralize(total, "boss", "bosses");
}

/** One raid of a preview: status, name, boss count, ordered boss list and what would change. */
function PlanPreview({ plan, compact = false }: { plan: RaidImportPlan; compact?: boolean }) {
  const reconcile = plan.staleBosses.length > 0 || plan.unaddedEncounters.length > 0;
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{plan.name}</p>
          <p className="text-xs text-muted">
            {bossCountLabel(plan)}
            {plan.previousName && plan.previousName !== plan.name
              ? ` · currently “${plan.previousName}”`
              : null}
          </p>
        </div>
        <ImportStatusBadge status={plan.status} />
      </div>
      {compact ? null : (
        <ol className="mt-2 space-y-0.5 text-sm">
          {plan.bosses.map((boss) => (
            <li key={boss.encounterId} className="flex gap-2">
              <span className="w-5 shrink-0 text-right text-muted">{boss.sortOrder}.</span>
              <span className="min-w-0 break-words">
                {boss.name}
                {boss.change === "NEW" && plan.raidId ? (
                  <span className="ml-1 text-xs text-accent">new</span>
                ) : null}
                {boss.previousName ? (
                  <span className="ml-1 text-xs text-muted">(was {boss.previousName})</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
      {plan.status === "UPDATE_AVAILABLE" && plan.changes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">
          {plan.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : null}
      {reconcile ? (
        <div className="mt-2 rounded bg-warning/10 p-2 text-xs text-warning">
          <p className="font-medium">
            Needs reconciliation — this raid is in use, so its boss list is kept:
          </p>
          <ul className="list-disc pl-4">
            {plan.unaddedEncounters.map((encounter) => (
              <li key={encounter.encounterId}>Blizzard lists {encounter.name}; not added.</li>
            ))}
            {plan.staleBosses.map((boss) => (
              <li key={boss.bossId}>{boss.name} is no longer in the Blizzard journal; kept.</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ Import Raid */

/** Primary way to add a raid: Blizzard Journal Instance ID → Fetch → preview → Import. */
export function ImportRaidDialog({ seasons }: { seasons: readonly string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { pending, error, setError, run } = useActionRunner();
  const [instanceId, setInstanceId] = useState("");
  const [preview, setPreview] = useState<RaidImportPreview | null>(null);
  const [season, setSeason] = useState("");
  const [trackLockouts, setTrackLockouts] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setInstanceId("");
    setPreview(null);
    setDone(null);
    setError(null);
  }

  function fetchPreview() {
    setDone(null);
    run(
      () => previewRaidImportAction({ journalInstanceId: instanceId }),
      (result) => {
        const next = result.preview ?? null;
        setPreview(next);
        setSeason(next?.defaults.season ?? "");
        setTrackLockouts(next?.defaults.trackLockouts ?? false);
      },
    );
  }

  function importNow() {
    if (!preview) return;
    run(
      () =>
        importRaidAction({
          journalInstanceId: preview.plan.instanceId,
          ...(preview.plan.raidId ? {} : { season, trackLockouts }),
        }),
      (result) => {
        setDone(result.message);
        setPreview(null);
        router.refresh();
      },
    );
  }

  const isNew = preview?.plan.status === "NEW";
  const seasonOptions = preview?.defaults.season ? [...seasons, preview.defaults.season] : seasons;

  return (
    <BlizzardFlowDialog
      dialogRef={dialogRef}
      triggerLabel="Import raid"
      triggerVariant="primary"
      title="Import raid from Blizzard"
      description="Raid name, bosses, boss order and Blizzard encounter ids come from the Blizzard Adventure Journal. Importing the same id again only updates Blizzard data — it never duplicates the raid."
      onOpen={reset}
      footer={
        preview ? (
          <Button type="button" onClick={importNow} disabled={pending || (isNew && !season.trim())}>
            {pending
              ? "Importing…"
              : preview.plan.status === "UP_TO_DATE"
                ? "Import again"
                : isNew
                  ? "Import raid"
                  : "Apply update"}
          </Button>
        ) : null
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          fetchPreview();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field
            label="Blizzard Journal Instance ID"
            hint="e.g. 1320 — the number in a Wowhead or Adventure Journal instance link."
          >
            <input
              className={fieldInputClass}
              inputMode="numeric"
              placeholder="1320"
              value={instanceId}
              onChange={(event) => setInstanceId(event.target.value)}
            />
          </Field>
        </div>
        <Button
          type="submit"
          variant="secondary"
          className="mb-5 h-9"
          disabled={pending || instanceId.trim() === ""}
        >
          {pending && !preview ? "Fetching…" : "Fetch"}
        </Button>
      </form>
      {preview ? (
        <>
          <PlanPreview plan={preview.plan} />
          {isNew ? (
            <>
              <SeasonSelector seasons={seasonOptions} value={season} onChange={setSeason} />
              <CheckboxField
                label="Track Blizzard lockouts"
                hint="On for current-season raids. Character syncs then derive this raid's lockouts — no further setup."
                checked={trackLockouts}
                onChange={setTrackLockouts}
              />
            </>
          ) : null}
        </>
      ) : null}
      {done ? <p className="text-sm text-success">{done}</p> : null}
      <ErrorLine error={error} />
    </BlizzardFlowDialog>
  );
}

/* ------------------------------------------------------------ Import Season */

export type ImportSeasonOption = { key: string; name: string; current: boolean; raidCount: number };

/** Import every raid of a code-defined season (src/lib/raid-seasons.ts). */
export function ImportSeasonDialog({ seasons }: { seasons: readonly ImportSeasonOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { pending, error, setError, run } = useActionRunner();
  const [seasonKey, setSeasonKey] = useState(seasons[0]?.key ?? "");
  const [preview, setPreview] = useState<SeasonImportPreview | null>(null);
  const [trackLockouts, setTrackLockouts] = useState(seasons[0]?.current ?? false);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setSeasonKey(seasons[0]?.key ?? "");
    setTrackLockouts(seasons[0]?.current ?? false);
    setPreview(null);
    setDone(null);
    setError(null);
  }

  function choose(key: string) {
    setSeasonKey(key);
    setTrackLockouts(seasons.find((season) => season.key === key)?.current ?? false);
    setPreview(null);
    setDone(null);
  }

  function fetchPreview() {
    setDone(null);
    run(
      () => previewSeasonImportAction({ seasonKey }),
      (result) => setPreview(result.preview ?? null),
    );
  }

  function importNow() {
    run(
      () => importSeasonAction({ seasonKey, trackLockouts }),
      (result) => {
        setDone(result.message);
        setPreview(null);
        router.refresh();
      },
    );
  }

  const hasNew = preview?.plans.some((plan) => plan.status === "NEW") ?? false;

  return (
    <BlizzardFlowDialog
      dialogRef={dialogRef}
      triggerLabel="Import season"
      title="Import season from Blizzard"
      description="Imports every raid of the season in one step. Raids that already exist only receive Blizzard data (names, bosses, order, encounter ids); nothing is duplicated and no Product is created."
      onOpen={reset}
      footer={
        preview ? (
          <Button type="button" onClick={importNow} disabled={pending}>
            {pending ? "Importing…" : "Import season"}
          </Button>
        ) : (
          <Button type="button" onClick={fetchPreview} disabled={pending || !seasonKey}>
            {pending ? "Fetching…" : "Preview"}
          </Button>
        )
      }
    >
      <Field label="Season">
        <select
          className={fieldInputClass}
          value={seasonKey}
          onChange={(event) => choose(event.target.value)}
        >
          {seasons.map((season) => (
            <option key={season.key} value={season.key}>
              {season.name}
              {season.current ? " (current)" : ""} · {pluralize(season.raidCount, "raid")}
            </option>
          ))}
        </select>
      </Field>
      {preview ? (
        <>
          <div className="space-y-2">
            {preview.plans.map((plan) => (
              <PlanPreview key={plan.instanceId} plan={plan} compact />
            ))}
          </div>
          {hasNew ? (
            <CheckboxField
              label="Track Blizzard lockouts for new raids"
              hint={
                preview.season.current
                  ? "On by default for the current season."
                  : "Historic season: only turn this on if you still sell runs for it."
              }
              checked={trackLockouts}
              onChange={setTrackLockouts}
            />
          ) : null}
        </>
      ) : null}
      {done ? <p className="text-sm text-success">{done}</p> : null}
      <ErrorLine error={error} />
    </BlizzardFlowDialog>
  );
}

/* ------------------------------------------------------------ Refresh */

/** Raid detail: preview Blizzard changes, then update only Blizzard-owned metadata. */
export function RefreshRaidDialog({ raidId }: { raidId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { pending, error, setError, run } = useActionRunner();
  const [preview, setPreview] = useState<RaidImportPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function open() {
    setPreview(null);
    setDone(null);
    setError(null);
    run(
      () => previewRaidRefreshAction({ raidId }),
      (result) => setPreview(result.preview ?? null),
    );
  }

  function apply() {
    run(
      () => refreshRaidFromBlizzardAction({ raidId }),
      (result) => {
        setDone(result.message);
        setPreview(null);
        router.refresh();
      },
    );
  }

  return (
    <BlizzardFlowDialog
      dialogRef={dialogRef}
      triggerLabel="Refresh from Blizzard"
      triggerClassName="h-8 px-2 text-xs"
      title="Refresh from Blizzard"
      description="Updates only Blizzard-owned data: raid name, boss names, boss order and encounter ids. Season, order, lockout tracking, Warcraft Logs ids, Products and Runs are not changed."
      onOpen={open}
      footer={
        preview && preview.plan.status === "UPDATE_AVAILABLE" ? (
          <Button type="button" onClick={apply} disabled={pending}>
            {pending ? "Refreshing…" : "Apply refresh"}
          </Button>
        ) : null
      }
    >
      {pending && !preview ? (
        <p className="text-sm text-muted">Fetching the Blizzard journal…</p>
      ) : null}
      {preview ? <PlanPreview plan={preview.plan} /> : null}
      {done ? <p className="text-sm text-success">{done}</p> : null}
      <ErrorLine error={error} />
    </BlizzardFlowDialog>
  );
}
