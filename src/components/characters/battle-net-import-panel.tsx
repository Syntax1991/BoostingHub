"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importBattleNetCharactersAction,
  linkBattleNetCharacterAction,
} from "@/controllers/blizzard.actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { CLASS_LABELS, REGION_LABELS } from "@/lib/labels";
import { specializationsForClass } from "@/lib/wow-specializations";
import type { ImportCandidate } from "@/lib/blizzard/types";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CandidatesPayload = NonNullable<Page["battleNet"]["candidates"]>;

function statusLabel(status: ImportCandidate["status"]): string {
  if (status === "import") return "Import";
  if (status === "link") return "Link";
  if (status === "already_linked") return "Already linked";
  return "Conflict";
}

export function BattleNetImportPanel({ candidates }: { candidates: CandidatesPayload | null }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [specs, setSpecs] = useState<Record<string, string>>({});

  const rows = useMemo(() => candidates?.candidates ?? [], [candidates]);
  const importSessionId = candidates?.sessionId;

  const selectableIds = useMemo(
    () =>
      rows
        .filter((row) => row.status === "import" || row.status === "link")
        .map((row) => row.blizzardCharacterId),
    [rows],
  );

  if (!candidates || rows.length === 0) {
    return null;
  }

  function toggle(id: string) {
    setSelected((current) => ({ ...current, [id]: !current[id] }));
  }

  function setSpec(id: string, value: string) {
    setSpecs((current) => ({ ...current, [id]: value }));
  }

  function resolveSpecialization(row: ImportCandidate): string | undefined {
    if (row.suggestedSpecialization) return row.suggestedSpecialization;
    const chosen = specs[row.blizzardCharacterId]?.trim();
    return chosen || undefined;
  }

  function importSelected() {
    if (!importSessionId) return;
    setError(null);
    setSuccess(null);

    const selections = rows
      .filter((row) => row.status === "import" && selected[row.blizzardCharacterId])
      .map((row) => {
        const specialization = resolveSpecialization(row);
        return {
          blizzardCharacterId: row.blizzardCharacterId,
          ...(specialization ? { specialization } : {}),
        };
      });

    const missingSpec = rows.find(
      (row) =>
        row.status === "import" &&
        selected[row.blizzardCharacterId] &&
        !row.suggestedSpecialization &&
        !specs[row.blizzardCharacterId]?.trim(),
    );
    if (missingSpec) {
      setError(`Choose a specialization for ${missingSpec.name}.`);
      return;
    }
    if (selections.length === 0) {
      setError("Select at least one character to import.");
      return;
    }

    startTransition(async () => {
      const result = await importBattleNetCharactersAction({
        importSessionId,
        selections,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      setSelected({});
      router.refresh();
    });
  }

  function linkRow(row: ImportCandidate) {
    if (!importSessionId || !row.characterId) return;
    setError(null);
    setSuccess(null);
    setLinkingId(row.blizzardCharacterId);
    startTransition(async () => {
      const result = await linkBattleNetCharacterAction({
        importSessionId,
        blizzardCharacterId: row.blizzardCharacterId,
        characterId: row.characterId,
      });
      setLinkingId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={`Import characters (${REGION_LABELS[candidates.region]})`}
        description="Owned Battle.net characters from the latest connect session."
      />
      <div className="space-y-3 px-4 py-4">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
            {success}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Select</th>
                <th className="px-2 py-2 font-medium">Character</th>
                <th className="px-2 py-2 font-medium">Class</th>
                <th className="px-2 py-2 font-medium">Level</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selectable = selectableIds.includes(row.blizzardCharacterId);
                const needsSpec = row.status === "import" && !row.suggestedSpecialization;
                const classSpecs = specializationsForClass(row.wowClass);
                return (
                  <tr key={row.blizzardCharacterId} className="border-t border-border align-top">
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[row.blizzardCharacterId])}
                        disabled={!selectable || pending}
                        onChange={() => toggle(row.blizzardCharacterId)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className="px-2 py-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted">{row.realm}</div>
                    </td>
                    <td className="px-2 py-3">{CLASS_LABELS[row.wowClass]}</td>
                    <td className="px-2 py-3">{row.level}</td>
                    <td className="px-2 py-3">{REGION_LABELS[row.region]}</td>
                    <td className="px-2 py-3">
                      <div>{statusLabel(row.status)}</div>
                      {row.status === "conflict" || row.status === "already_linked" ? (
                        <p className="mt-1 text-xs text-muted">
                          {row.conflictReason ??
                            (row.status === "already_linked"
                              ? "Already linked to a character on this account."
                              : "Cannot import this character.")}
                        </p>
                      ) : null}
                      {needsSpec ? (
                        <label className="mt-2 block text-xs">
                          <span className="mb-1 block text-muted">Specialization</span>
                          <select
                            value={specs[row.blizzardCharacterId] ?? ""}
                            disabled={pending}
                            onChange={(event) => setSpec(row.blizzardCharacterId, event.target.value)}
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
                      ) : null}
                      {row.status === "import" && row.suggestedSpecialization ? (
                        <p className="mt-1 text-xs text-muted">
                          Spec: {row.suggestedSpecialization}
                          {row.suggestedItemLevel != null ? ` · iLvl ${row.suggestedItemLevel}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      {row.status === "link" && row.characterId ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => linkRow(row)}
                          className="h-8 px-2 text-xs"
                        >
                          {linkingId === row.blizzardCharacterId && pending ? "Linking…" : "Link"}
                        </Button>
                      ) : row.status === "already_linked" || row.status === "conflict" ? (
                        <span className="text-xs text-muted">Unavailable</span>
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={importSelected}
            className="h-8 px-3 text-xs"
            aria-describedby={error ? errorId : undefined}
          >
            {pending && !linkingId ? "Importing…" : "Import selected"}
          </Button>
          <span className="text-xs text-muted">
            Import creates new characters. Link attaches Battle.net to an existing match.
          </span>
        </div>
      </div>
    </Card>
  );
}
