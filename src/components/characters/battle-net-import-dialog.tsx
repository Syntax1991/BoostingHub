"use client";

import { useEffect, useId, useRef, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  enrichImportCandidateAction,
  importBattleNetCharactersAction,
} from "@/controllers/blizzard.actions";
import { Button } from "@/components/ui/button";
import { REGION_LABELS } from "@/lib/labels";
import { MIN_IMPORT_CHARACTER_LEVEL } from "@/lib/blizzard/import-rules";
import { continueActionLabel, isSelectableImportCandidate, selectionCountLabel } from "@/lib/blizzard/import-selection";
import { useBattleNetImportSelection } from "@/hooks/use-battle-net-import-selection";
import { BattleNetImportTable } from "@/components/characters/battle-net-import-table";
import { BattleNetImportCardList } from "@/components/characters/battle-net-import-card-list";
import type { ImportCandidate } from "@/lib/blizzard/types";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CandidatesPayload = NonNullable<Page["battleNet"]["candidates"]>;

/** Bounded-concurrency background enrichment; avoids hammering Blizzard for accounts with many characters. */
const ENRICHMENT_CONCURRENCY = 4;

export function BattleNetImportDialog({
  open,
  onOpenChange,
  candidates,
  battleTag,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: CandidatesPayload | null;
  battleTag?: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const searchId = useId();
  const errorId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = candidates?.candidates ?? [];
  const importSessionId = candidates?.sessionId;
  const selection = useBattleNetImportSelection(rows);

  /** Synchronous dedup so the background scan and manual selection never double-request the same row. */
  const startedEnrichmentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      onOpenChange(false);
      setError(null);
      selection.reset();
      startedEnrichmentRef.current = new Set();
    };
    dialog.addEventListener("close", onClose);
    queueMicrotask(() => searchRef.current?.focus());
    return () => dialog.removeEventListener("close", onClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection.reset is stable per render cycle, not a dep we want to retrigger on
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) return;
    returnFocusRef?.current?.focus();
  }, [open, returnFocusRef]);

  function close() {
    dialogRef.current?.close();
    onOpenChange(false);
  }

  /**
   * Fetches public profile enrichment for one row, independent of selection.
   * `startedEnrichmentRef` guards synchronously so the background scan below
   * and a manual toggle/select-all can never double-request the same row —
   * React state updates too late for that check.
   */
  function enrichRow(row: ImportCandidate) {
    if (!importSessionId || !isSelectableImportCandidate(row)) return;
    if (startedEnrichmentRef.current.has(row.blizzardCharacterId)) return;
    startedEnrichmentRef.current.add(row.blizzardCharacterId);

    selection.markEnriching(row.blizzardCharacterId, true);
    return enrichImportCandidateAction({
      importSessionId,
      blizzardCharacterId: row.blizzardCharacterId,
    }).then((result) => {
      selection.markEnriching(row.blizzardCharacterId, false);
      selection.applyEnrichmentResult(row.blizzardCharacterId, result.ok ? result.data : null);
    });
  }

  /**
   * Enriches every eligible candidate as soon as the session loads, not just
   * selected ones, so the User sees Blizzard's Spec/Item Level before
   * choosing. Bounded concurrency avoids firing dozens of parallel Blizzard
   * requests for a large account.
   */
  useEffect(() => {
    if (!importSessionId) return;
    const eligible = rows.filter((row) => isSelectableImportCandidate(row));
    if (eligible.length === 0) return;

    let cursor = 0;
    async function worker() {
      while (cursor < eligible.length) {
        const row = eligible[cursor++]!;
        await enrichRow(row);
      }
    }
    const workerCount = Math.min(ENRICHMENT_CONCURRENCY, eligible.length);
    void Promise.all(Array.from({ length: workerCount }, () => worker()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enrichRow reads live state via the selection hook's own setters
  }, [rows, importSessionId]);

  function submit() {
    if (!importSessionId) return;
    setError(null);

    const result = selection.validateSelectionsForSubmit(
      (row) => `${row.name} cannot be imported because level ${MIN_IMPORT_CHARACTER_LEVEL} is required.`,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }

    startTransition(async () => {
      const outcome = await importBattleNetCharactersAction({
        importSessionId,
        selections: result.selections,
      });
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  if (!open || !candidates) return null;

  const allAlreadyLinked =
    rows.length > 0 && rows.every((row) => row.status === "already_linked");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed left-1/2 top-[5vh] m-0 flex w-[min(64rem,calc(100vw-1.5rem))] max-h-[min(90vh,52rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Import characters · {REGION_LABELS[candidates.region]}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Select Battle.net characters at level {MIN_IMPORT_CHARACTER_LEVEL}+ to import or link.
          Choose specialization for each selection; item level comes from Blizzard when available.
          {battleTag ? ` Connected as ${battleTag}.` : null}
        </p>
      </div>

      <div className="shrink-0 space-y-3 border-b border-border px-4 py-3">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <label htmlFor={searchId} className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Search</span>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={selection.query}
            onChange={(event) => selection.setQuery(event.target.value)}
            placeholder="Name, realm, or class"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={pending || selection.visibleEligibleIds.length === 0}
            onClick={selection.selectAllEligibleVisible}
          >
            Select all eligible
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={pending || selection.selectedCount === 0}
            onClick={selection.clearSelection}
          >
            Clear selection
          </Button>
          <label className="flex items-center gap-2 md:hidden">
            <span className="text-muted">Sort by</span>
            <select
              value={selection.itemLevelSort ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                selection.selectItemLevelSort(value === "asc" || value === "desc" ? value : null);
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
              aria-label="Sort by item level"
            >
              <option value="">Session order</option>
              <option value="desc">Item Level: High → Low</option>
              <option value="asc">Item Level: Low → High</option>
            </select>
          </label>
          <span className="text-muted">
            Eligible = Import or Link existing at level {MIN_IMPORT_CHARACTER_LEVEL}+ in current results.
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2 sm:px-4">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">
            No characters were returned for this Battle.net region.
          </p>
        ) : allAlreadyLinked ? (
          <p className="px-2 py-8 text-center text-sm text-muted">
            All discovered characters are already linked.
          </p>
        ) : selection.visibleRows.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">No characters match this search.</p>
        ) : (
          <>
            <BattleNetImportTable
              rows={selection.visibleRows}
              pending={pending}
              selected={selection.selected}
              enriching={selection.enriching}
              specs={selection.specs}
              itemLevelSort={selection.itemLevelSort}
              suggestedFor={selection.suggestedFor}
              blizzardItemLevelFor={selection.blizzardItemLevelFor}
              onToggle={selection.toggle}
              onSpecChange={selection.setSpec}
              onCycleItemLevelSort={selection.cycleItemLevelSort}
            />
            <BattleNetImportCardList
              rows={selection.visibleRows}
              pending={pending}
              selected={selection.selected}
              enriching={selection.enriching}
              specs={selection.specs}
              suggestedFor={selection.suggestedFor}
              blizzardItemLevelFor={selection.blizzardItemLevelFor}
              onToggle={selection.toggle}
              onSpecChange={selection.setSpec}
            />
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-sm text-muted" aria-live="polite">
          {selectionCountLabel(selection.selectedCount)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-9 px-3 text-sm" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-9 px-3 text-sm"
            disabled={!selection.canContinue(pending)}
            onClick={submit}
            aria-describedby={error ? errorId : undefined}
          >
            {pending ? "Working…" : continueActionLabel(selection.selectedCount)}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
