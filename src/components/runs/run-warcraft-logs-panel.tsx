"use client";

import { useId, useState, useTransition } from "react";
import {
  analyzeRunConsumablesAction,
  attachRunWarcraftLogsReportAction,
  decideRunWarcraftLogsFightAction,
  detachRunWarcraftLogsReportAction,
  rescanRunWarcraftLogsAction,
} from "@/controllers/run-consumable-audit.actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDateTime, formatTime } from "@/lib/datetime";
import type { ActionResult } from "@/lib/action-result";
import type { WclFightReason, WclFightStatus } from "@/services/wcl-fight-assignment";
import type { RunWarcraftLogsFightView, RunWarcraftLogsView } from "@/services/run-warcraft-logs.service";

/** Concrete evidence, never a score. */
const REASON_TEXT: Partial<Record<WclFightReason, string>> = {
  TIME_MATCH: "Time matches Run",
  RUN_WINDOW_UNKNOWN: "Run start/end time not recorded",
  RUN_END_UNKNOWN: "Run completion time not recorded",
  MULTIPLE_RUN_WINDOWS: "Matches multiple Run time windows",
  ROSTER_RESOLVED: "Roster clearly matches this Run",
  LOW_ROSTER_OVERLAP: "Few roster members in this fight",
  BELONGS_TO_OTHER_RUN: "Roster clearly matches another Run",
  ASSIGNED_TO_OTHER_RUN: "Assigned to another Run",
  CONTENT_MATCH: "Encounter matches Run content",
  ENCOUNTER_NOT_IN_CATALOG: "Encounter not in the raid catalog",
  ENCOUNTER_NOT_IN_RUN_CONTENT: "Encounter is not part of this Run's content",
  DIFFICULTY_MISMATCH: "Different difficulty than this Run",
  MANUAL: "Set manually",
};

const STATUS_STYLE: Record<WclFightStatus, string> = {
  ASSIGNED: "bg-success/15 text-success",
  NEEDS_REVIEW: "bg-warning/15 text-warning",
  IGNORED: "bg-muted/15 text-muted",
};

const STATUS_LABEL: Record<WclFightStatus, string> = {
  ASSIGNED: "In this run",
  NEEDS_REVIEW: "Needs review",
  IGNORED: "Not in this run",
};

function evidence(fight: RunWarcraftLogsFightView): string[] {
  const lines = fight.reasons.map((reason) => REASON_TEXT[reason]).filter((line): line is string => Boolean(line));
  if (fight.rosterMatched != null && fight.rosterSize != null) {
    lines.push(`${fight.rosterMatched}/${fight.rosterSize} roster members in this fight`);
  }
  return lines;
}

function useAction() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  function run(action: () => Promise<ActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) window.location.reload();
    });
  }
  return { pending, message, run };
}

function FightRow({ fight, runId }: { fight: RunWarcraftLogsFightView; runId: string }) {
  const { pending, message, run } = useAction();
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-medium">{fight.label}</span>{" "}
          <span className="text-muted">
            · {formatTime(fight.startAt)} · #{fight.wclFightId}
          </span>{" "}
          <span className={cn("ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS_STYLE[fight.status])}>
            {STATUS_LABEL[fight.status]}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted">{evidence(fight).join(" · ")}</p>
        {message && !message.ok ? (
          <p role="alert" className="mt-0.5 text-xs text-danger">
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {fight.status !== "ASSIGNED" ? (
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => run(() => decideRunWarcraftLogsFightAction({ runId, fightId: fight.id, assign: true }))}
          >
            Assign to this run
          </Button>
        ) : null}
        {fight.status !== "IGNORED" ? (
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => run(() => decideRunWarcraftLogsFightAction({ runId, fightId: fight.id, assign: false }))}
          >
            Remove from this run
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function RunWarcraftLogsPanel({
  runId,
  logs,
  canManage,
  wclConfigured,
  stale,
  hasSnapshot,
}: {
  runId: string;
  logs: RunWarcraftLogsView;
  canManage: boolean;
  wclConfigured: boolean;
  stale: boolean;
  hasSnapshot: boolean;
}) {
  const inputId = useId();
  const [report, setReport] = useState("");
  const { pending, message, run } = useAction();
  const review = logs.fights.filter((fight) => fight.status === "NEEDS_REVIEW");
  const toleranceMinutes = Math.round(logs.toleranceSeconds / 60);

  return (
    <div className="space-y-3 border-b border-border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Warcraft Logs</h3>
        <p className="text-xs text-muted">
          {logs.runWindow.startedAt
            ? `Run active ${formatDateTime(logs.runWindow.startedAt)}–${
                logs.runWindow.completedAt ? formatTime(logs.runWindow.completedAt) : "end not recorded"
              } (±${toleranceMinutes} min)`
            : "Run start/end not recorded — fights need manual review"}
        </p>
      </div>

      {logs.reports.length === 0 ? (
        <p className="text-muted">No report linked yet.</p>
      ) : (
        <ul className="space-y-2">
          {logs.reports.map((row) => (
            <li key={row.code} className="rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <a href={row.url} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                    {row.code}
                  </a>
                  {row.title ? <span className="ml-2 text-muted">{row.title}</span> : null}
                  <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-muted">
                    {row.source === "DISCORD_BOT" ? "via Discord log bot" : row.attachedByName ? `linked by ${row.attachedByName}` : "linked manually"}
                  </span>
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Detach report ${row.code} from this run?`)) {
                        run(() => detachRunWarcraftLogsReportAction({ runId, reportCode: row.code }));
                      }
                    }}
                  >
                    Detach
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted">
                {row.assigned} {row.assigned === 1 ? "fight" : "fights"} associated
                {row.assignedFrom && row.assignedTo
                  ? ` · ${formatTime(row.assignedFrom)}–${formatTime(row.assignedTo)}`
                  : ""}
                {row.needsReview > 0 ? (
                  <span className="text-warning">
                    {" "}
                    · {row.needsReview} {row.needsReview === 1 ? "fight needs" : "fights need"} review
                  </span>
                ) : null}
                {row.lastScannedAt == null ? " · fights are assigned after the run is completed" : ""}
                {row.sharedWithRuns > 0
                  ? ` · also used by ${row.sharedWithRuns} other ${row.sharedWithRuns === 1 ? "run" : "runs"}`
                  : ""}
                {row.overlappingFights > 0
                  ? ` · ${row.overlappingFights === row.assigned ? "all" : row.overlappingFights} ${
                      row.overlappingFights === 1 ? "fight" : "fights"
                    } also logged in another linked report — counted once in the audit`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canManage && wclConfigured ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => attachRunWarcraftLogsReportAction({ runId, report }));
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="mb-1 block text-xs text-muted">
              {logs.reports.length === 0 ? "Link report" : "Add another report"}
            </label>
            <input
              id={inputId}
              type="text"
              value={report}
              onChange={(event) => setReport(event.target.value)}
              placeholder="https://www.warcraftlogs.com/reports/…"
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-3 text-sm"
              disabled={pending}
            />
          </div>
          <Button type="submit" disabled={pending || !report.trim()}>
            {pending ? "Working…" : "Link & analyze"}
          </Button>
          {logs.reports.length > 0 ? (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => rescanRunWarcraftLogsAction({ runId }))}
              >
                Re-scan fights
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => analyzeRunConsumablesAction({ runId }))}
              >
                Re-analyze
              </Button>
            </>
          ) : null}
        </form>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={cn("text-xs", message.ok ? "text-success" : "text-danger")}>
          {message.text}
        </p>
      ) : null}
      {stale && hasSnapshot ? (
        <p role="status" className="text-xs text-warning">
          Fight assignment changed since the last analysis — Re-analyze to update the audit.
        </p>
      ) : null}

      {review.length > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="text-xs font-semibold text-warning">
            {review.length === 1 ? "1 fight assignment needs review" : `${review.length} fight assignments need review`}
          </p>
          <ul className="divide-y divide-border/60">
            {review.map((fight) => (
              <FightRow key={fight.id} fight={fight} runId={runId} />
            ))}
          </ul>
        </div>
      ) : null}

      {logs.fights.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">All report fights in this run&apos;s window ({logs.fights.length})</summary>
          <ul className="mt-1 divide-y divide-border/60">
            {logs.fights.map((fight) => (
              <FightRow key={fight.id} fight={fight} runId={runId} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
