"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClassIcon } from "@/components/ui/badges";
import { WarningIcon } from "@/components/ui/ops-icons";
import {
  applyRangeAssignment,
  bossesInRange,
  nextBossRange,
  rangeAssignment,
  resetSlotBosses,
  slotCharacterChoices,
  slotHasBossChoices,
  type BossPlanEditorSignup,
  type BossRange,
  type LiveBossPlanEvaluation,
} from "@/components/manage/roster-boss-plan-editor";
import { formatBossRanges, type RosterBossException, type RunBoss } from "@/lib/roster-boss-plan";
import { CHARACTER_ROLE_LABELS, CLASS_COLORS } from "@/lib/labels";
import type { CharacterRole, WowClass } from "@/models/enums";

export type BossPlanPanelSlot = {
  signup: BossPlanEditorSignup;
  name: string;
  wowClass: WowClass | null;
  role: CharacterRole | null;
};

const MIXED = "__mixed__";
const OWN = "__own__";

/**
 * Boss plan: pick one boss or a contiguous range, then change a slot's
 * Character (another signed-up Character of the same player) and/or role
 * for exactly those bosses. Every slot starts on its normal Character and
 * role; only deviations are staged, and Save / Update stay the roster's own.
 */
export function RosterBossPlanPanel({
  bosses,
  exceptions,
  slots,
  signups,
  stagedSlotIds,
  evaluation,
  editing,
  onChange,
}: {
  bosses: readonly RunBoss[];
  /** Staged DRAFT exceptions (already pruned to the staged roster). */
  exceptions: readonly RosterBossException[];
  /** Staged Booster slots in roster order. */
  slots: readonly BossPlanPanelSlot[];
  signups: readonly BossPlanEditorSignup[];
  stagedSlotIds: ReadonlySet<string>;
  evaluation: LiveBossPlanEvaluation;
  editing: boolean;
  onChange: (next: RosterBossException[]) => void;
}) {
  const [range, setRange] = useState<BossRange | null>(null);
  const rangeBosses = bossesInRange(bosses, range);
  const contentCount = new Set(bosses.map((boss) => boss.runRaidContentId)).size;
  const exceptionBossKeys = new Set(exceptions.map((row) => `${row.runRaidContentId}:${row.raidBossId}`));
  const warningBossKeys = new Set(evaluation.warnings.flatMap((warning) => warning.bossKeys));
  const rows = slots
    .map((slot) => ({ slot, choices: slotCharacterChoices(slot.signup, signups, stagedSlotIds) }))
    .filter((row) => slotHasBossChoices(row.choices));
  const fixedCount = slots.length - rows.length;

  const byContent = new Map<string, RunBoss[]>();
  for (const boss of bosses) {
    const list = byContent.get(boss.runRaidContentId) ?? [];
    list.push(boss);
    byContent.set(boss.runRaidContentId, list);
  }

  function assign(slot: BossPlanPanelSlot, playSignupId: string | null, role: CharacterRole) {
    onChange(
      applyRangeAssignment({
        exceptions,
        slotSignupId: slot.signup.id,
        slotRole: slot.role,
        range: rangeBosses,
        assignment: { playSignupId, role },
      }),
    );
  }

  return (
    <section aria-labelledby="boss-plan-title" className="space-y-2.5 rounded-md border border-border bg-surface-raised/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 id="boss-plan-title" className="text-sm font-semibold text-foreground">
            Boss plan
          </h4>
          <p className="text-xs text-muted">
            The roster above plays every boss. Pick a boss, or a boss and then another for a range, to change a
            Character or role there.
          </p>
        </div>
        {editing && exceptions.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
            Reset all bosses
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" role="group" aria-label="Bosses">
        {[...byContent.values()].map((list) => (
          <div key={list[0]!.runRaidContentId} className="flex flex-wrap items-center gap-1">
            {contentCount > 1 ? (
              <span className="mr-0.5 text-xs font-medium text-muted">{list[0]!.raidShortName ?? list[0]!.raidName}</span>
            ) : null}
            {list.map((boss) => {
              const selected = rangeBosses.includes(boss);
              return (
                <button
                  key={boss.key}
                  type="button"
                  aria-pressed={selected}
                  title={`${boss.bossNumber}. ${boss.bossName}`}
                  onClick={() => setRange((current) => nextBossRange(current, boss.key))}
                  className={`relative inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold tabular-nums ${
                    selected
                      ? "border-accent bg-accent/15 text-foreground"
                      : "border-border text-muted hover:border-accent/60 hover:text-foreground"
                  }`}
                >
                  {boss.bossNumber}
                  {exceptionBossKeys.has(boss.key) ? (
                    <span aria-label="Has exceptions" className="absolute -top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
                  ) : null}
                  {warningBossKeys.has(boss.key) ? (
                    <span aria-label="Has warnings" className="absolute -bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-warning" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {rangeBosses.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">{formatBossRanges(rangeBosses, bosses)}</span> ·{" "}
            {rangeBosses.length === 1
              ? rangeBosses[0]!.bossName
              : `${rangeBosses[0]!.bossName} – ${rangeBosses[rangeBosses.length - 1]!.bossName}`}
          </p>
          {rows.length === 0 ? (
            <p className="text-xs text-muted">No slot has another Character or role to switch to.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map(({ slot, choices }) => {
                const current = rangeAssignment({
                  exceptions,
                  slotSignupId: slot.signup.id,
                  slotRole: slot.role,
                  range: rangeBosses,
                });
                const mixed = current === "MIXED";
                const playChoice = mixed ? null : (choices.find((choice) => choice.playSignupId === current.playSignupId) ?? choices[0]!);
                const roleOptions = playChoice?.roles ?? [];
                const deviates =
                  mixed || current.playSignupId != null || (current.role != null && current.role !== slot.role);
                return (
                  <li key={slot.signup.id} className="grid grid-cols-1 items-center gap-1.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_12rem_9rem_auto]">
                    <span className="flex min-w-0 items-center gap-2">
                      {slot.wowClass ? <ClassIcon wowClass={slot.wowClass} size={20} /> : null}
                      <span
                        className="min-w-0 truncate text-[13px] font-semibold"
                        style={slot.wowClass ? { color: CLASS_COLORS[slot.wowClass] } : undefined}
                      >
                        {slot.name}
                      </span>
                      {deviates ? <span className="shrink-0 text-xs text-accent">changed</span> : null}
                    </span>
                    <select
                      aria-label={`Character for ${slot.name}`}
                      disabled={!editing}
                      value={mixed ? MIXED : (current.playSignupId ?? OWN)}
                      onChange={(event) => {
                        const choice = choices.find((row) => (row.playSignupId ?? OWN) === event.target.value);
                        if (!choice) return;
                        const role =
                          slot.role && (choice.roles as readonly CharacterRole[]).includes(slot.role) ? slot.role : choice.roles[0];
                        if (role) assign(slot, choice.playSignupId, role);
                      }}
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      {mixed ? (
                        <option value={MIXED} disabled>
                          Mixed
                        </option>
                      ) : null}
                      {choices.map((choice) => (
                        <option key={choice.playSignupId ?? OWN} value={choice.playSignupId ?? OWN}>
                          {choice.label}
                          {choice.playSignupId == null ? " (roster)" : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Role for ${slot.name}`}
                      disabled={!editing || mixed}
                      value={mixed ? MIXED : (current.role ?? "")}
                      onChange={(event) => {
                        const role = roleOptions.find((option) => option === event.target.value);
                        if (role && !mixed) assign(slot, current.playSignupId, role);
                      }}
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      {mixed ? <option value={MIXED}>Mixed</option> : null}
                      {!mixed && current.role == null ? <option value="">Choose role</option> : null}
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {CHARACTER_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <span className="flex justify-end">
                      {editing && deviates ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Reset ${slot.name} on ${formatBossRanges(rangeBosses, bosses)}`}
                          onClick={() => onChange(resetSlotBosses(exceptions, slot.signup.id, rangeBosses))}
                        >
                          Reset
                        </Button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {fixedCount > 0 && rows.length > 0 ? (
            <p className="text-xs text-muted">
              {fixedCount} other slot{fixedCount === 1 ? "" : "s"} {fixedCount === 1 ? "has" : "have"} no other Character
              or role.
            </p>
          ) : null}
        </div>
      ) : null}

      {evaluation.issues.length > 0 || evaluation.warnings.length > 0 ? (
        <ul className="space-y-1 border-t border-border/60 pt-2 text-xs">
          {evaluation.issues.map((issue) => (
            <li key={`issue:${issue.message}`} className="text-danger">
              {issue.message}
            </li>
          ))}
          {evaluation.warnings.map((warning) => (
            <li key={`warning:${warning.message}`} className="flex items-start gap-1.5 text-warning">
              <WarningIcon label="Boss warning" size={13} />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
