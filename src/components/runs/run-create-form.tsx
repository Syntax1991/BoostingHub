"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { DIFFICULTY_LABELS, ROLE_LABELS } from "@/lib/labels";
import { RAID_DIFFICULTIES, type RaidDifficulty } from "@/models/enums";
import type { CreateRunForm } from "@/services/run.service";
import { runDetailPath } from "@/lib/run-routes";

export function RunCreateForm({ form }: { form: CreateRunForm }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [raidId, setRaidId] = useState(form.raids[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(form.defaults.difficulty);
  const [scheduledLocal, setScheduledLocal] = useState(toDatetimeLocalValue(form.defaults.scheduledStartAt));
  const [raidLeadId, setRaidLeadId] = useState(form.defaultRaidLeadId);
  const [notes, setNotes] = useState("");
  const [desiredTankCount, setDesiredTankCount] = useState(form.defaults.desiredTankCount);
  const [desiredHealerCount, setDesiredHealerCount] = useState(form.defaults.desiredHealerCount);
  const [desiredDpsCount, setDesiredDpsCount] = useState(form.defaults.desiredDpsCount);

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      let scheduledStartAt: string;
      try {
        scheduledStartAt = fromDatetimeLocalValue(scheduledLocal);
      } catch {
        setError("Enter a valid scheduled start.");
        return;
      }

      const result = await createRunAction({
        title: title.trim() || undefined,
        raidId,
        difficulty,
        scheduledStartAt,
        raidLeadId: form.canAssignRaidLead ? raidLeadId : undefined,
        notes: notes.trim() || undefined,
        desiredTankCount,
        desiredHealerCount,
        desiredDpsCount,
      });

      if (!result.ok || !result.runId) {
        setError(result.ok ? "Run was created but no id was returned." : result.message);
        return;
      }

      window.location.assign(runDetailPath(result.runId));
    });
  }

  return (
    <Card>
      <form className="space-y-3 px-4 py-4" onSubmit={submit}>
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
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Title (optional)</span>
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Leave blank to use raid and difficulty"
            className="h-9 w-full rounded-md border border-border bg-surface px-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Raid</span>
          <select
            aria-label="Raid"
            value={raidId}
            onChange={(event) => setRaidId(event.target.value)}
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
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Difficulty</span>
          <select
            aria-label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as RaidDifficulty)}
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
          <span className="mb-1 block text-muted">Scheduled start (Europe/Berlin)</span>
          <input
            type="datetime-local"
            name="scheduledStartAt"
            value={scheduledLocal}
            onChange={(event) => setScheduledLocal(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            className="h-9 w-full rounded-md border border-border bg-surface px-2"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Raid Lead</span>
          {form.canAssignRaidLead ? (
            <select
              aria-label="Raid Lead"
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
                aria-label="Raid Lead"
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
              aria-label="Desired tanks"
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
              aria-label="Desired healers"
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
              aria-label="Desired DPS"
            />
          </label>
        </div>
        <p className="text-xs text-muted">Composition targets are planning values, not a fixed raid size.</p>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-2 py-2"
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={() => router.push("/manage/runs")}>
            Back
          </Button>
          <Button type="submit" disabled={pending || form.raids.length === 0}>
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
