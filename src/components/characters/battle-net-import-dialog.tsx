"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  enrichImportCandidateAction,
  importBattleNetCharactersAction,
} from "@/controllers/blizzard.actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badges";
import { CLASS_LABELS, REGION_LABELS } from "@/lib/labels";
import { specializationsForClass } from "@/lib/wow-specializations";
import { MIN_IMPORT_CHARACTER_LEVEL } from "@/lib/blizzard/import-rules";
import {
  continueActionLabel,
  eligibleCandidateIds,
  filterImportCandidates,
  importStatusLabel,
  isSelectableImportCandidate,
  itemLevelSortAria,
  itemLevelSortLabel,
  nextItemLevelSortDirection,
  resolvedSpecialization,
  selectionCountLabel,
  sortImportCandidatesByItemLevel,
  type ItemLevelSortDirection,
} from "@/lib/blizzard/import-selection";
import type { ImportCandidate } from "@/lib/blizzard/types";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CandidatesPayload = NonNullable<Page["battleNet"]["candidates"]>;

function statusBadgeClass(status: ImportCandidate["status"]): string {
  if (status === "import") return "bg-success/15 text-success";
  if (status === "link") return "bg-info/15 text-info";
  if (status === "already_linked") return "bg-surface-raised text-muted";
  if (status === "level_too_low") return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}

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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<
    Record<string, { specialization: string | null; itemLevel: number | null }>
  >({});
  const [enriching, setEnriching] = useState<Record<string, boolean>>({});
  const [itemLevelSort, setItemLevelSort] = useState<ItemLevelSortDirection | null>(null);

  const rows = useMemo(() => candidates?.candidates ?? [], [candidates]);
  const importSessionId = candidates?.sessionId;

  function blizzardItemLevelFor(row: ImportCandidate) {
    return suggestions[row.blizzardCharacterId]?.itemLevel ?? row.suggestedItemLevel;
  }

  const visibleRows = useMemo(() => {
    const filtered = filterImportCandidates(rows, query);
    if (!itemLevelSort) return filtered;
    const sortable = filtered.map((row) => ({
      ...row,
      sortItemLevel: blizzardItemLevelFor(row),
    }));
    return sortImportCandidatesByItemLevel(sortable, itemLevelSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local form maps intentionally included
  }, [rows, query, itemLevelSort, suggestions]);

  const visibleEligibleIds = useMemo(
    () => eligibleCandidateIds(visibleRows),
    [visibleRows],
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selected[row.blizzardCharacterId]),
    [rows, selected],
  );
  const selectedCount = selectedRows.length;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      onOpenChange(false);
      setError(null);
      setQuery("");
      setSelected({});
      setSpecs({});
      setSuggestions({});
      setEnriching({});
      setItemLevelSort(null);
    };
    dialog.addEventListener("close", onClose);
    queueMicrotask(() => searchRef.current?.focus());
    return () => dialog.removeEventListener("close", onClose);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) return;
    returnFocusRef?.current?.focus();
  }, [open, returnFocusRef]);

  function close() {
    dialogRef.current?.close();
    onOpenChange(false);
  }

  function suggestedFor(row: ImportCandidate) {
    return (
      suggestions[row.blizzardCharacterId]?.specialization ?? row.suggestedSpecialization
    );
  }

  function requestEnrichment(row: ImportCandidate) {
    if (!importSessionId || !isSelectableImportCandidate(row)) return;
    if (enriching[row.blizzardCharacterId]) return;
    if (suggestions[row.blizzardCharacterId]) return;

    setEnriching((current) => ({ ...current, [row.blizzardCharacterId]: true }));
    void enrichImportCandidateAction({
      importSessionId,
      blizzardCharacterId: row.blizzardCharacterId,
    }).then((result) => {
      setEnriching((current) => ({ ...current, [row.blizzardCharacterId]: false }));
      if (!result.ok || !result.data) {
        setSuggestions((current) => ({
          ...current,
          [row.blizzardCharacterId]: { specialization: null, itemLevel: null },
        }));
        return;
      }
      const specialization = result.data.suggestedSpecialization;
      setSuggestions((current) => ({
        ...current,
        [row.blizzardCharacterId]: {
          specialization,
          itemLevel: result.data!.suggestedItemLevel,
        },
      }));
      if (specialization) {
        setSpecs((current) =>
          current[row.blizzardCharacterId]
            ? current
            : { ...current, [row.blizzardCharacterId]: specialization },
        );
      }
    });
  }

  function toggle(row: ImportCandidate) {
    if (!isSelectableImportCandidate(row) || pending) return;
    const id = row.blizzardCharacterId;
    const next = !selected[id];
    setSelected((current) => ({ ...current, [id]: next }));
    if (next) requestEnrichment(row);
  }

  function selectAllEligibleVisible() {
    setSelected((current) => {
      const next = { ...current };
      for (const id of visibleEligibleIds) next[id] = true;
      return next;
    });
    for (const row of visibleRows) {
      if (isSelectableImportCandidate(row)) requestEnrichment(row);
    }
  }

  function clearSelection() {
    setSelected({});
  }

  function canContinue(): boolean {
    if (selectedCount === 0 || pending) return false;
    return selectedRows.every((row) => {
      if (!isSelectableImportCandidate(row)) return false;
      const specialization = resolvedSpecialization(row, specs[row.blizzardCharacterId], suggestedFor(row));
      if (!specialization) return false;
      // Item level is read-only Blizzard data; still loading is the only
      // remaining blocker — an unavailable value never blocks continuing.
      return !enriching[row.blizzardCharacterId];
    });
  }

  function submit() {
    if (!importSessionId) return;
    setError(null);

    if (selectedCount === 0) {
      setError("Select at least one eligible character.");
      return;
    }

    for (const row of selectedRows) {
      if (!isSelectableImportCandidate(row)) {
        setError(
          row.status === "level_too_low"
            ? `${row.name} cannot be imported because level ${MIN_IMPORT_CHARACTER_LEVEL} is required.`
            : `${row.name} cannot be imported or linked.`,
        );
        return;
      }

      const specialization = resolvedSpecialization(
        row,
        specs[row.blizzardCharacterId],
        suggestedFor(row),
      );
      if (!specialization) {
        setError(`Select a specialization for ${row.name}.`);
        return;
      }
      if (enriching[row.blizzardCharacterId]) {
        setError(`Still loading Blizzard profile data for ${row.name}.`);
        return;
      }
    }

    // Item level is never submitted from the client — Blizzard is
    // authoritative and the server re-resolves it from its own profile read.
    const selections = selectedRows.map((row) => ({
      blizzardCharacterId: row.blizzardCharacterId,
      specialization: resolvedSpecialization(row, specs[row.blizzardCharacterId], suggestedFor(row)),
    }));

    startTransition(async () => {
      const result = await importBattleNetCharactersAction({
        importSessionId,
        selections,
      });
      if (!result.ok) {
        setError(result.message);
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, realm, or class"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={pending || visibleEligibleIds.length === 0}
            onClick={selectAllEligibleVisible}
          >
            Select all eligible
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={pending || selectedCount === 0}
            onClick={clearSelection}
          >
            Clear selection
          </Button>
          <label className="flex items-center gap-2 md:hidden">
            <span className="text-muted">Sort by</span>
            <select
              value={itemLevelSort ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setItemLevelSort(value === "asc" || value === "desc" ? value : null);
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
        ) : visibleRows.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">No characters match this search.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Select</th>
                    <th className="px-2 py-2 font-medium">Character</th>
                    <th className="px-2 py-2 font-medium">Class</th>
                    <th className="px-2 py-2 font-medium">Level</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Specialization</th>
                    <th className="px-2 py-2 font-medium" aria-sort={itemLevelSortAria(itemLevelSort)}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                        onClick={() => setItemLevelSort((current) => nextItemLevelSortDirection(current))}
                      >
                        {itemLevelSortLabel(itemLevelSort)}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <ImportTableRow
                      key={row.blizzardCharacterId}
                      row={row}
                      pending={pending}
                      selected={Boolean(selected[row.blizzardCharacterId])}
                      enriching={Boolean(enriching[row.blizzardCharacterId])}
                      suggested={suggestedFor(row)}
                      blizzardItemLevel={blizzardItemLevelFor(row)}
                      specValue={specs[row.blizzardCharacterId] ?? ""}
                      onToggle={() => toggle(row)}
                      onSpecChange={(value) =>
                        setSpecs((current) => ({ ...current, [row.blizzardCharacterId]: value }))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {visibleRows.map((row) => (
                <ImportMobileCard
                  key={row.blizzardCharacterId}
                  row={row}
                  pending={pending}
                  selected={Boolean(selected[row.blizzardCharacterId])}
                  enriching={Boolean(enriching[row.blizzardCharacterId])}
                  suggested={suggestedFor(row)}
                  blizzardItemLevel={blizzardItemLevelFor(row)}
                  specValue={specs[row.blizzardCharacterId] ?? ""}
                  onToggle={() => toggle(row)}
                  onSpecChange={(value) =>
                    setSpecs((current) => ({ ...current, [row.blizzardCharacterId]: value }))
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-sm text-muted" aria-live="polite">
          {selectionCountLabel(selectedCount)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-9 px-3 text-sm" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-9 px-3 text-sm"
            disabled={!canContinue()}
            onClick={submit}
            aria-describedby={error ? errorId : undefined}
          >
            {pending ? "Working…" : continueActionLabel(selectedCount)}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

type RowControls = {
  row: ImportCandidate;
  pending: boolean;
  selected: boolean;
  enriching: boolean;
  suggested: string | null;
  blizzardItemLevel: number | null;
  specValue: string;
  onToggle: () => void;
  onSpecChange: (value: string) => void;
};

function ImportTableRow({
  row,
  pending,
  selected,
  enriching,
  suggested,
  blizzardItemLevel,
  specValue,
  onToggle,
  onSpecChange,
}: RowControls) {
  const selectable = isSelectableImportCandidate(row);
  const classSpecs = specializationsForClass(row.wowClass);
  const showControls = selected && selectable;
  const effectiveSpec = resolvedSpecialization(row, specValue, suggested);

  return (
    <tr
      className={`border-t border-border align-top ${selectable ? "" : "bg-surface-raised/40"}`}
    >
      <td className="px-2 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable || pending}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
      </td>
      <td className="px-2 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted">{row.realm}</div>
      </td>
      <td className="px-2 py-3">{CLASS_LABELS[row.wowClass]}</td>
      <td className="px-2 py-3">{row.level}</td>
      <td className="px-2 py-3">
        <Badge className={statusBadgeClass(row.status)}>{importStatusLabel(row.status)}</Badge>
        {row.conflictReason && row.status !== "level_too_low" ? (
          <p className="mt-1 text-xs text-muted">{row.conflictReason}</p>
        ) : null}
        {row.status === "level_too_low" ? (
          <p className="mt-1 text-xs text-muted">
            Discovered by Battle.net, but BoostingHub requires level {MIN_IMPORT_CHARACTER_LEVEL}+.
          </p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        {showControls ? (
          enriching && !effectiveSpec ? (
            <span className="text-xs text-muted">Loading…</span>
          ) : (
            <label className="block text-xs">
              <span className="sr-only">Specialization for {row.name}</span>
              <select
                value={effectiveSpec}
                disabled={pending}
                onChange={(event) => onSpecChange(event.target.value)}
                aria-label={`Specialization for ${row.name}`}
                className="h-8 w-full max-w-[12rem] rounded-md border border-border bg-surface px-2 text-sm"
              >
                <option value="">Select…</option>
                {classSpecs.map((spec) => (
                  <option key={spec.name} value={spec.name}>
                    {spec.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-2 py-3">
        {enriching && blizzardItemLevel == null ? (
          <span className="text-xs text-muted">Loading…</span>
        ) : typeof blizzardItemLevel === "number" ? (
          <div className="text-xs">
            <span className="font-medium">{blizzardItemLevel}</span>
            <span className="text-muted"> · Blizzard</span>
          </div>
        ) : (
          <span className="text-xs text-muted">Unknown</span>
        )}
      </td>
    </tr>
  );
}

function ImportMobileCard(props: RowControls) {
  const {
    row,
    pending,
    selected,
    enriching,
    suggested,
    blizzardItemLevel,
    specValue,
    onToggle,
    onSpecChange,
  } = props;
  const selectable = isSelectableImportCandidate(row);
  const classSpecs = specializationsForClass(row.wowClass);
  const showControls = selected && selectable;
  const effectiveSpec = resolvedSpecialization(row, specValue, suggested);

  return (
    <div
      className={`rounded-md border border-border px-3 py-3 ${selectable ? "" : "bg-surface-raised/40"}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected}
          disabled={!selectable || pending}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted">
            {row.realm} · {CLASS_LABELS[row.wowClass]} · Level {row.level}
          </div>
          <div className="mt-2">
            <Badge className={statusBadgeClass(row.status)}>{importStatusLabel(row.status)}</Badge>
          </div>
          {row.status === "level_too_low" ? (
            <p className="mt-2 text-xs text-muted">
              Requires level {MIN_IMPORT_CHARACTER_LEVEL}.
            </p>
          ) : null}
          {showControls ? (
            <div className="mt-3 space-y-2">
              <label className="block text-xs">
                <span className="mb-1 block text-muted">Specialization</span>
                <select
                  value={effectiveSpec}
                  disabled={pending || (enriching && !effectiveSpec)}
                  onChange={(event) => onSpecChange(event.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  <option value="">Select…</option>
                  {classSpecs.map((spec) => (
                    <option key={spec.name} value={spec.name}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs">
                <span className="mb-1 block text-muted">Item Level</span>
                {typeof blizzardItemLevel === "number" ? (
                  <span>{blizzardItemLevel} · Blizzard</span>
                ) : enriching ? (
                  <span className="text-muted">Loading…</span>
                ) : (
                  <span className="text-muted">Unknown</span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
