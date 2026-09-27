"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RunWarcraftLogsPanel } from "@/components/runs/run-warcraft-logs-panel";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ClassIcon, RoleBadge } from "@/components/ui/badges";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/datetime";
import {
  CONSUMABLE_AUDIT_FAILURE_LABELS,
  CONSUMABLE_AUDIT_MATCH_LABELS,
  formatFightClock,
  summarizeCombatPotionUses,
} from "@/lib/consumable-audit-display";
import { CONSUMABLE_CATEGORY_LABELS } from "@/lib/consumable-catalog";
import type {
  ConsumableCheckStatus,
  ConsumableUseView,
  DeathConsumableContext,
  FightRef,
  PlayerConsumableAudit,
} from "@/services/consumable-audit-policy";
import type { RunConsumableAuditView } from "@/services/run-consumable-audit.service";

const STATUS_STYLES: Record<ConsumableCheckStatus, string> = {
  PASS: "bg-success/15 text-success",
  WARNING: "bg-warning/15 text-warning",
  NEUTRAL: "bg-surface-raised text-foreground",
  NA: "bg-muted/15 text-muted",
  UNKNOWN: "bg-muted/15 text-muted",
};

const STATUS_TITLES: Record<ConsumableCheckStatus, string> = {
  PASS: "Requirement met",
  WARNING: "Needs attention",
  NEUTRAL: "Shown for information — not a failure",
  NA: "Not applicable",
  UNKNOWN: "Log data unavailable",
};

function StatusChip({ status, children, title }: { status: ConsumableCheckStatus; children: string; title?: string }) {
  const icon = status === "PASS" ? "✓ " : status === "WARNING" ? "⚠ " : "";
  return (
    <span
      title={title ?? STATUS_TITLES[status]}
      className={cn("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium", STATUS_STYLES[status])}
    >
      {icon}
      {children}
    </span>
  );
}

function fightLabel(fight: FightRef, contentLabels: Map<string, string | null>): string {
  const content = contentLabels.get(fight.fightId);
  return content ? `${content} · ${fight.label}` : fight.label;
}

function flaskText(player: PlayerConsumableAudit): string {
  const { flask } = player;
  if (flask.status === "UNKNOWN") return "Unknown";
  if (flask.fightsChecked <= 1) return flask.status === "PASS" ? "Active" : "Missing";
  return `${flask.fightsWithFlask}/${flask.fightsChecked}`;
}

function combatText(player: PlayerConsumableAudit): string {
  if (player.combatPotion.status === "UNKNOWN" && !player.role) return "Role unknown";
  if (player.combatPotion.status === "NA" && player.combatPotion.uses.length === 0) return "N/A (no kills)";
  return summarizeCombatPotionUses(player.combatPotion.uses);
}

function countText(uses: ConsumableUseView[], status: ConsumableCheckStatus): string {
  if (status === "NA") return "N/A";
  if (status === "UNKNOWN" && uses.length === 0) return "Unknown";
  return uses.length === 0 ? "0" : `${uses.length}x`;
}

function deathContextText(label: string, context: DeathConsumableContext): { text: string; warn: boolean } {
  switch (context.status) {
    case "USED":
      return { text: `Used @ ${formatFightClock(context.atFightMs)} (${context.spellName})`, warn: false };
    case "NOT_USED":
      return { text: `No ${label} use detected before death`, warn: true };
    case "NOT_APPLICABLE":
      return { text: "N/A — no Warlock or Healthstone use in this fight", warn: false };
    case "UNKNOWN":
      return { text: "Unknown — fight participants not reported", warn: false };
  }
}

function UseList({ uses, contentLabels }: { uses: ConsumableUseView[]; contentLabels: Map<string, string | null> }) {
  if (uses.length === 0) return <p className="text-muted">No use detected.</p>;
  return (
    <ul className="space-y-0.5">
      {uses.map((use, index) => (
        <li key={index}>
          <span className="font-mono">{formatFightClock(use.atFightMs)}</span>{" "}
          <span className="text-muted">
            {fightLabel(use.fight, contentLabels)} · {use.spellName}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlayerDetails({
  player,
  contentLabels,
  lookbackSeconds,
}: {
  player: PlayerConsumableAudit;
  contentLabels: Map<string, string | null>;
  lookbackSeconds: number;
}) {
  const accepted = player.combatPotion.accepted.map((category) => CONSUMABLE_CATEGORY_LABELS[category]).join(" or ");
  return (
    <div className="grid gap-4 px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <section>
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted">Flask</h4>
        <p>
          {player.flask.fightsChecked === 0
            ? "No pull snapshot in the log — flask unknown."
            : `Active at pull in ${player.flask.fightsWithFlask} of ${player.flask.fightsChecked} fights.`}
          {player.flask.flaskNames.length > 0 ? ` (${player.flask.flaskNames.join(", ")})` : ""}
        </p>
        {player.flask.missing.length > 0 ? (
          <p className="mt-1 text-warning">
            No flask at pull: {player.flask.missing.map((fight) => fightLabel(fight, contentLabels)).join(", ")}
          </p>
        ) : null}
        {player.flask.unknown.length > 0 ? (
          <p className="mt-1 text-muted">
            Unknown (no pull snapshot): {player.flask.unknown.map((fight) => fightLabel(fight, contentLabels)).join(", ")}
          </p>
        ) : null}
      </section>
      <section>
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted">Combat Potion</h4>
        <p className="mb-1 text-muted">
          {player.role ? `Expected per boss kill: ${accepted}.` : "Role unknown — no expectation applied."}
        </p>
        <UseList uses={player.combatPotion.uses} contentLabels={contentLabels} />
        {player.combatPotion.missing.length > 0 ? (
          <p className="mt-1 text-warning">
            No accepted combat potion: {player.combatPotion.missing.map((fight) => fightLabel(fight, contentLabels)).join(", ")}
          </p>
        ) : null}
      </section>
      <section>
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted">Healing Potion</h4>
        <UseList uses={player.healingPotion.uses} contentLabels={contentLabels} />
      </section>
      <section>
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted">Healthstone</h4>
        {player.healthstone.applicability === "NOT_APPLICABLE" ? (
          <p className="text-muted">N/A — no Warlock or Healthstone use in this player&apos;s fights.</p>
        ) : (
          <UseList uses={player.healthstone.uses} contentLabels={contentLabels} />
        )}
      </section>
      <section className="sm:col-span-2">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted">
          Deaths · {player.deaths.length}
        </h4>
        {player.deaths.length === 0 ? (
          <p className="text-muted">No deaths.</p>
        ) : (
          <ul className="space-y-2">
            {player.deaths.map((death) => {
              const healing = deathContextText("Healing Potion", death.healingPotion);
              const stone = deathContextText("Healthstone", death.healthstone);
              return (
                <li key={death.number}>
                  <p className="font-medium">
                    Death #{death.number} · {fightLabel(death.fight, contentLabels)} @{" "}
                    <span className="font-mono">{formatFightClock(death.atFightMs)}</span>
                  </p>
                  <p className={healing.warn ? "text-warning" : undefined}>Healing Potion: {healing.text}</p>
                  <p className={stone.warn ? "text-warning" : undefined}>Healthstone: {stone.text}</p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-muted">
          Looks back {lookbackSeconds}s before each death, within the same fight. The log shows what was used,
          not what was in the player&apos;s bags.
        </p>
      </section>
    </div>
  );
}

export function RunConsumablesSection({ audit }: { audit: RunConsumableAuditView }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const snapshot = audit.snapshot;
  const contentLabels = new Map(
    (snapshot?.fights ?? []).map((fight) => [fight.fightId, fight.contentLabel] as const),
  );

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title="Consumables"
        description="Warcraft Logs facts per booster — flask, combat potion, and personal recovery around deaths. Raid Lead / Admin only."
      />
      {!audit.wclConfigured ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted">
          Warcraft Logs API is not configured on this server, so reports cannot be analyzed.
        </p>
      ) : null}
      <RunWarcraftLogsPanel
        runId={audit.runId}
        logs={audit.logs}
        canManage={audit.canAnalyze}
        wclConfigured={audit.wclConfigured}
        stale={audit.stale}
        hasSnapshot={Boolean(audit.snapshot)}
      />
      {audit.analyzedAt || audit.lastFailure || audit.autoAudit ? (
        <div className="space-y-1 border-b border-border px-4 py-2 text-xs text-muted">
          {audit.analyzedAt ? (
            <p>
              Analyzed {formatDateTime(audit.analyzedAt)}
              {audit.autoAnalyzed
                ? " automatically after completion"
                : audit.analyzedByName
                  ? ` by ${audit.analyzedByName}`
                  : ""}
            </p>
          ) : null}
          {audit.autoAudit?.state === "SCHEDULED" ? (
            <p role="status">
              Automatic analysis scheduled from {formatDateTime(audit.autoAudit.dueAt)} — gives late uploads time to
              reach Warcraft Logs.
            </p>
          ) : null}
          {audit.autoAudit?.state === "GAVE_UP" ? (
            <p role="status" className="text-warning">
              Automatic analysis did not succeed after {audit.autoAudit.attempts} attempts — use Re-scan fights.
            </p>
          ) : null}
          {audit.lastFailure ? (
            <p role="alert" className="text-warning">
              Last attempt failed: {CONSUMABLE_AUDIT_FAILURE_LABELS[audit.lastFailure]}
              {snapshot ? " Showing the previous analysis." : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {!snapshot ? (
        <EmptyState
          title="No consumables analysis yet"
          description="Link the run's Warcraft Logs report. Only fights assigned to this run are analyzed."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted">
            <span>{snapshot.summary.players} boosters</span>
            <span>
              {snapshot.summary.fights} fights ({snapshot.summary.kills} kills)
            </span>
            <span>{snapshot.summary.deaths} deaths</span>
            <span className={snapshot.summary.playersWithWarnings > 0 ? "text-warning" : undefined}>
              {snapshot.summary.playersWithWarnings} with warnings
            </span>
            {snapshot.summary.withoutLogData > 0 ? (
              <span>{snapshot.summary.withoutLogData} without log data</span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Flask</th>
                  <th className="px-3 py-2 font-medium">Combat Pot</th>
                  <th className="px-3 py-2 font-medium">Heal Pot</th>
                  <th className="px-3 py-2 font-medium">HS</th>
                  <th className="px-3 py-2 font-medium">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.players.map((player) => {
                  const open = expanded.has(player.id);
                  return (
                    <Fragment key={player.id}>
                      <tr className="border-b border-border/60 align-top">
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => toggle(player.id)}
                            aria-expanded={open}
                            disabled={!player.hasLogData}
                            className="inline-flex items-center gap-1.5 text-left disabled:cursor-default"
                          >
                            {player.hasLogData ? (
                              open ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                              )
                            ) : (
                              <span className="inline-block w-3.5" aria-hidden />
                            )}
                            {player.wowClass ? <ClassIcon wowClass={player.wowClass} size={16} /> : null}
                            <span className="font-medium">{player.characterName || player.displayName}</span>
                          </button>
                          <p className="ml-5 text-xs text-muted">
                            {player.isExternal ? "External booster" : player.displayName}
                          </p>
                        </td>
                        <td className="px-3 py-2">{player.role ? <RoleBadge role={player.role} /> : <span className="text-muted">—</span>}</td>
                        {!player.hasLogData ? (
                          <td colSpan={5} className="px-3 py-2">
                            <StatusChip status="UNKNOWN">
                              {player.matchStatus === "MATCHED"
                                ? "Log data unavailable — not in any audited fight"
                                : CONSUMABLE_AUDIT_MATCH_LABELS[player.matchStatus]}
                            </StatusChip>
                          </td>
                        ) : (
                          <>
                            <td className="px-3 py-2">
                              <StatusChip status={player.flask.status}>{flaskText(player)}</StatusChip>
                            </td>
                            <td className="px-3 py-2">
                              <StatusChip status={player.combatPotion.status}>{combatText(player)}</StatusChip>
                            </td>
                            <td className="px-3 py-2">
                              <StatusChip status={player.healingPotion.status}>
                                {countText(player.healingPotion.uses, player.healingPotion.status)}
                              </StatusChip>
                            </td>
                            <td className="px-3 py-2">
                              <StatusChip status={player.healthstone.status}>
                                {countText(player.healthstone.uses, player.healthstone.status)}
                              </StatusChip>
                            </td>
                            <td className="px-3 py-2">
                              <StatusChip
                                status={player.deathWarnings > 0 ? "WARNING" : "NEUTRAL"}
                                title={
                                  player.deathWarnings > 0
                                    ? "A death without a detected Healing Potion or Healthstone"
                                    : "Deaths"
                                }
                              >
                                {String(player.deaths.length)}
                              </StatusChip>
                            </td>
                          </>
                        )}
                      </tr>
                      {open && player.hasLogData ? (
                        <tr className="border-b border-border/60 bg-surface-raised/40">
                          <td colSpan={7}>
                            <PlayerDetails
                              player={player}
                              contentLabels={contentLabels}
                              lookbackSeconds={audit.lookbackSeconds}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details className="px-4 py-3 text-xs">
            <summary className="cursor-pointer text-muted">Fights analyzed ({snapshot.fights.length})</summary>
            <ul className="mt-2 space-y-0.5">
              {snapshot.fights.map((fight) => (
                <li key={fight.fightId}>
                  {fightLabel(fight, contentLabels)} · {formatFightClock(fight.durationMs)}
                  <span className="text-muted">
                    {" "}
                    · Healthstones:{" "}
                    {fight.healthstone === "APPLICABLE"
                      ? "available (Warlock or use seen)"
                      : fight.healthstone === "NOT_APPLICABLE"
                        ? "N/A (no Warlock)"
                        : "unknown"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Card>
  );
}
