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
import {
  continueActionLabel,
  eligibleCandidateIds,
  filterImportCandidates,
  importStatusLabel,
  isEligibleImportStatus,
  needsSpecializationFallback,
  selectionCountLabel,
} from "@/lib/blizzard/import-selection";
import type { ImportCandidate } from "@/lib/blizzard/types";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CandidatesPayload = NonNullable<Page["battleNet"]["candidates"]>;

function statusBadgeClass(status: ImportCandidate["status"]): string {
  if (status === "import") return "bg-success/15 text-success";
  if (status === "link") return "bg-info/15 text-info";
  if (status === "already_linked") return "bg-surface-raised text-muted";
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

  const rows = useMemo(() => candidates?.candidates ?? [], [candidates]);
  const importSessionId = candidates?.sessionId;
  const visibleRows = useMemo(() => filterImportCandidates(rows, query), [rows, query]);
  const visibleEligibleIds = useMemo(
    () => eligibleCandidateIds(visibleRows),
    [visibleRows],
  );
  const selectedCount = useMemo(
    () => rows.filter((row) => selected[row.blizzardCharacterId]).length,
    [rows, selected],
  );

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

  function itemLevelFor(row: ImportCandidate) {
    return suggestions[row.blizzardCharacterId]?.itemLevel ?? row.suggestedItemLevel;
  }

  function requestEnrichment(row: ImportCandidate) {
    if (!importSessionId || row.status !== "import") return;
    if (suggestedFor(row) || enriching[row.blizzardCharacterId]) return;

    setEnriching((current) => ({ ...current, [row.blizzardCharacterId]: true }));
    void enrichImportCandidateAction({
      importSessionId,
      blizzardCharacterId: row.blizzardCharacterId,
    }).then((result) => {
      setEnriching((current) => ({ ...current, [row.blizzardCharacterId]: false }));
      if (!result.ok || !result.data) return;
      setSuggestions((current) => ({
        ...current,
        [row.blizzardCharacterId]: {
          specialization: result.data!.suggestedSpecialization,
          itemLevel: result.data!.suggestedItemLevel,
        },
      }));
    });
  }

  function toggle(row: ImportCandidate) {
    if (!isEligibleImportStatus(row.status) || pending) return;
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
      if (isEligibleImportStatus(row.status)) requestEnrichment(row);
    }
  }

  function clearSelection() {
    setSelected({});
  }

  function submit() {
    if (!importSessionId) return;
    setError(null);

    const chosen = rows.filter((row) => selected[row.blizzardCharacterId]);
    if (chosen.length === 0) {
      setError("Select at least one eligible character.");
      return;
    }

    const blocked = chosen.find((row) => !isEligibleImportStatus(row.status));
    if (blocked) {
      setError(`${blocked.name} cannot be imported or linked.`);
      return;
    }

    const missingSpec = chosen.find((row) =>
      needsSpecializationFallback(row, true, suggestedFor(row)) &&
      !specs[row.blizzardCharacterId]?.trim(),
    );
    if (missingSpec) {
      setError(`Choose a specialization for ${missingSpec.name}.`);
      return;
    }

    const selections = chosen.map((row) => {
      const specialization =
        suggestedFor(row)?.trim() || specs[row.blizzardCharacterId]?.trim() || undefined;
      return {
        blizzardCharacterId: row.blizzardCharacterId,
        ...(specialization ? { specialization } : {}),
      };
    });

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
      className="fixed left-1/2 top-[5vh] m-0 flex w-[min(56rem,calc(100vw-1.5rem))] max-h-[min(90vh,52rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Import characters · {REGION_LABELS[candidates.region]}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Select the Battle.net characters you want to import or link to BoostingHub.
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
          <span className="text-muted">
            Showing eligible matches in the current search results only.
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">Select</th>
                  <th className="px-2 py-2 font-medium">Character</th>
                  <th className="px-2 py-2 font-medium">Class</th>
                  <th className="px-2 py-2 font-medium">Level</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Specialization</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const selectable = isEligibleImportStatus(row.status);
                  const isSelected = Boolean(selected[row.blizzardCharacterId]);
                  const suggested = suggestedFor(row);
                  const showFallback = needsSpecializationFallback(row, isSelected, suggested);
                  const classSpecs = specializationsForClass(row.wowClass);
                  const iLvl = itemLevelFor(row);
                  return (
                    <tr
                      key={row.blizzardCharacterId}
                      className={`border-t border-border align-top ${
                        selectable ? "" : "opacity-70"
                      }`}
                    >
                      <td className="px-2 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!selectable || pending}
                          onChange={() => toggle(row)}
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
                        <Badge className={statusBadgeClass(row.status)}>
                          {importStatusLabel(row.status)}
                        </Badge>
                        {row.conflictReason || row.status === "already_linked" ? (
                          <p className="mt-1 text-xs text-muted">
                            {row.conflictReason ??
                              "Already linked to a character on this account."}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-3">
                        {row.status === "link" ? (
                          <span className="text-xs text-muted">Uses existing specialization</span>
                        ) : enriching[row.blizzardCharacterId] ? (
                          <span className="text-xs text-muted">Loading…</span>
                        ) : suggested ? (
                          <div className="text-xs">
                            <span>{suggested}</span>
                            {iLvl != null ? (
                              <span className="text-muted"> · iLvl {iLvl}</span>
                            ) : null}
                          </div>
                        ) : showFallback ? (
                          <label className="block text-xs">
                            <span className="mb-1 block text-muted">Specialization</span>
                            <select
                              value={specs[row.blizzardCharacterId] ?? ""}
                              disabled={pending}
                              onChange={(event) =>
                                setSpecs((current) => ({
                                  ...current,
                                  [row.blizzardCharacterId]: event.target.value,
                                }))
                              }
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
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            disabled={pending || selectedCount === 0}
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
