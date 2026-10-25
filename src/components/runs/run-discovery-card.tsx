"use client";

import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import { runDetailPath } from "@/lib/run-routes";
import { cn } from "@/lib/cn";
import type { runController } from "@/controllers/app.controller";

type RunRow = Awaited<ReturnType<typeof runController.getRunsPage>>["runs"][number];

/** Compact “You” line — one phrase, not a badge pile. */
export function formatRunUserState(
  run: Pick<RunRow, "alreadySigned" | "currentUserSignups" | "ownSignupCount">,
): string | null {
  if (!run.alreadySigned || run.currentUserSignups.length === 0) return null;
  const statuses = run.currentUserSignups.map((s) => s.status);
  if (statuses.some((s) => s === "SELECTED")) {
    const n = statuses.filter((s) => s === "SELECTED").length;
    return n > 1 ? `Selected ×${n}` : "Selected";
  }
  if (statuses.some((s) => s === "PENDING")) {
    const n = statuses.filter((s) => s === "PENDING").length;
    return n > 1 ? `Pending · Signed ×${n}` : "Pending";
  }
  if (statuses.every((s) => s === "NOT_SELECTED")) return "Not selected";
  if (statuses.every((s) => s === "WITHDRAWN")) return "Withdrawn";
  return run.ownSignupCount > 1 ? `Signed ×${run.ownSignupCount}` : "Signed";
}

function youTone(label: string): string {
  if (label.startsWith("Selected")) return "text-success";
  if (label.startsWith("Pending")) return "text-warning";
  return "text-muted";
}

/**
 * Discovery card for user-facing /runs — whole surface links to Run Detail;
 * signup control stays a nested interactive (stopPropagation).
 */
export function RunDiscoveryCard({
  run,
  timeZone,
  layout = "grid",
}: {
  run: RunRow;
  timeZone: string;
  layout?: "grid" | "list";
}) {
  const you = formatRunUserState(run);
  const href = runDetailPath(run.id);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border/50 bg-surface/55 transition-colors hover:border-border hover:bg-surface-raised/40",
        layout === "list" && "sm:flex sm:items-stretch",
      )}
    >
      <Link href={href} className="absolute inset-0 z-0" aria-label={`Open ${run.title}`}>
        <span className="sr-only">Open run</span>
      </Link>

      <div
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 flex-col gap-2 p-3.5 pointer-events-none",
          layout === "list" && "sm:flex-row sm:items-center sm:gap-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground group-hover:text-accent">
              {run.title}
            </h3>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <DifficultyBadge difficulty={run.difficulty} />
              <RunStatusBadge status={run.status} />
            </div>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted">
            {run.productLabel}
            {run.contentSummary ? ` · ${run.contentSummary}` : ""}
          </p>
          <dl
            className={cn(
              "mt-2 grid gap-x-4 gap-y-1 text-[12px]",
              layout === "grid" ? "grid-cols-2" : "sm:grid-cols-4",
            )}
          >
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted/80">When</dt>
              <dd className="text-foreground/85">
                {formatDate(run.scheduledStartAt, timeZone)}{" "}
                <span className="text-muted">{formatTime(run.scheduledStartAt, timeZone)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted/80">Raid Lead</dt>
              <dd className="truncate text-foreground/85">{run.raidLeadDisplayName}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted/80">Comp</dt>
              <dd className="tabular-nums text-foreground/85">
                {run.desiredTankCount}T / {run.desiredHealerCount}H / {run.desiredDpsCount}D
                {run.desiredLootbuddyCount > 0 ? ` · ${run.desiredLootbuddyCount}LB` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted/80">Signups</dt>
              <dd className="tabular-nums text-foreground/85">
                {run.signupCount}
                <span className="text-muted">
                  {" "}
                  · {run.selectedCount} sel · {run.signupWindowOpen ? "open" : "closed"}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2",
            layout === "list" && "sm:flex-col sm:items-end",
          )}
        >
          {you ? (
            <p className={cn("text-[12px] font-medium", youTone(you))}>{you}</p>
          ) : (
            <p className="text-[12px] text-muted">Not signed</p>
          )}
          <div
            className="pointer-events-auto"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <RunSignupButton
              runId={run.id}
              signupWindowOpen={run.signupWindowOpen}
              ownSignupCount={run.ownSignupCount}
              timeZone={timeZone}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
