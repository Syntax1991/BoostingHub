import { useMemo, useState } from "react";
import {
  eligibleCandidateIds,
  filterImportCandidates,
  isSelectableImportCandidate,
  nextItemLevelSortDirection,
  resolvedSpecialization,
  sortImportCandidatesByItemLevel,
  type ItemLevelSortDirection,
} from "@/lib/blizzard/import-selection";
import type { ImportCandidate } from "@/lib/blizzard/types";

type Suggestion = { specialization: string | null; itemLevel: number | null };

/**
 * Owns the Battle.net import dialog's client-only state: search, sort,
 * selection, specialization choices, and enrichment prefill data. Never
 * calls a server action or touches Blizzard/DB directly — enrichment
 * fetching stays in the dialog container, which feeds results back in via
 * `applyEnrichmentResult` / `markEnriching`.
 */
export function useBattleNetImportSelection(rows: ImportCandidate[]) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [enriching, setEnriching] = useState<Record<string, boolean>>({});
  const [itemLevelSort, setItemLevelSort] = useState<ItemLevelSortDirection | null>(null);

  function blizzardItemLevelFor(row: ImportCandidate) {
    return suggestions[row.blizzardCharacterId]?.itemLevel ?? row.suggestedItemLevel;
  }

  function suggestedFor(row: ImportCandidate) {
    return suggestions[row.blizzardCharacterId]?.specialization ?? row.suggestedSpecialization;
  }

  function resolvedSpecFor(row: ImportCandidate): string {
    return resolvedSpecialization(row, specs[row.blizzardCharacterId], suggestedFor(row));
  }

  const visibleRows = useMemo(() => {
    const aboveMinLevel = rows.filter((row) => row.status !== "level_too_low");
    const filtered = filterImportCandidates(aboveMinLevel, query);
    if (!itemLevelSort) return filtered;
    const sortable = filtered.map((row) => ({
      ...row,
      sortItemLevel: blizzardItemLevelFor(row),
    }));
    return sortImportCandidatesByItemLevel(sortable, itemLevelSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suggestions/specs read via the closures above
  }, [rows, query, itemLevelSort, suggestions]);

  const visibleEligibleIds = useMemo(() => eligibleCandidateIds(visibleRows), [visibleRows]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selected[row.blizzardCharacterId]),
    [rows, selected],
  );

  function toggle(row: ImportCandidate) {
    if (!isSelectableImportCandidate(row)) return;
    const id = row.blizzardCharacterId;
    setSelected((current) => ({ ...current, [id]: !current[id] }));
  }

  function selectAllEligibleVisible() {
    setSelected((current) => {
      const next = { ...current };
      for (const id of visibleEligibleIds) next[id] = true;
      return next;
    });
  }

  function clearSelection() {
    setSelected({});
  }

  function setSpec(blizzardCharacterId: string, value: string) {
    setSpecs((current) => ({ ...current, [blizzardCharacterId]: value }));
  }

  function markEnriching(blizzardCharacterId: string, value: boolean) {
    setEnriching((current) => ({ ...current, [blizzardCharacterId]: value }));
  }

  /** Records a fetched enrichment result; prefills specialization only if the user hasn't chosen one yet. */
  function applyEnrichmentResult(
    blizzardCharacterId: string,
    result: { suggestedSpecialization: string | null; suggestedItemLevel: number | null } | null,
  ) {
    const specialization = result?.suggestedSpecialization ?? null;
    const itemLevel = result?.suggestedItemLevel ?? null;
    setSuggestions((current) => ({
      ...current,
      [blizzardCharacterId]: { specialization, itemLevel },
    }));
    if (specialization) {
      setSpecs((current) =>
        current[blizzardCharacterId] ? current : { ...current, [blizzardCharacterId]: specialization },
      );
    }
  }

  function cycleItemLevelSort() {
    setItemLevelSort((current) => nextItemLevelSortDirection(current));
  }

  function selectItemLevelSort(direction: ItemLevelSortDirection | null) {
    setItemLevelSort(direction);
  }

  /** Validates the current selection for submit; never touches the network itself. */
  function validateSelectionsForSubmit(minLevelMessage: (row: ImportCandidate) => string):
    | { ok: true; selections: Array<{ blizzardCharacterId: string; specialization: string }> }
    | { ok: false; message: string } {
    if (selectedRows.length === 0) {
      return { ok: false, message: "Select at least one eligible character." };
    }

    for (const row of selectedRows) {
      if (!isSelectableImportCandidate(row)) {
        return {
          ok: false,
          message: row.status === "level_too_low" ? minLevelMessage(row) : `${row.name} cannot be imported or linked.`,
        };
      }
      const specialization = resolvedSpecFor(row);
      if (!specialization) {
        return { ok: false, message: `Select a specialization for ${row.name}.` };
      }
      if (enriching[row.blizzardCharacterId]) {
        return { ok: false, message: `Still loading Blizzard profile data for ${row.name}.` };
      }
    }

    return {
      ok: true,
      // Item level is never submitted from the client — Blizzard is
      // authoritative and the server re-resolves it from its own profile read.
      selections: selectedRows.map((row) => ({
        blizzardCharacterId: row.blizzardCharacterId,
        specialization: resolvedSpecFor(row),
      })),
    };
  }

  function canContinue(pending: boolean): boolean {
    if (selectedRows.length === 0 || pending) return false;
    return selectedRows.every((row) => {
      if (!isSelectableImportCandidate(row)) return false;
      if (!resolvedSpecFor(row)) return false;
      // Item level is read-only Blizzard data; still loading is the only
      // remaining blocker — an unavailable value never blocks continuing.
      return !enriching[row.blizzardCharacterId];
    });
  }

  function reset() {
    setQuery("");
    setSelected({});
    setSpecs({});
    setSuggestions({});
    setEnriching({});
    setItemLevelSort(null);
  }

  return {
    query,
    setQuery,
    itemLevelSort,
    cycleItemLevelSort,
    selectItemLevelSort,
    visibleRows,
    visibleEligibleIds,
    selected,
    selectedRows,
    selectedCount: selectedRows.length,
    specs,
    suggestions,
    enriching,
    toggle,
    selectAllEligibleVisible,
    clearSelection,
    setSpec,
    markEnriching,
    applyEnrichmentResult,
    suggestedFor,
    blizzardItemLevelFor,
    resolvedSpecFor,
    canContinue,
    validateSelectionsForSubmit,
    reset,
  };
}
