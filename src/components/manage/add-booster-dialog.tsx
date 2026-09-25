"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  addRosterPlayerAction,
  getRosterManualAddOptionsAction,
  searchRosterPlayersAction,
} from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS } from "@/lib/labels";
import type { CharacterRole } from "@/models/enums";

type PlayerMatch = NonNullable<Awaited<ReturnType<typeof searchRosterPlayersAction>>["data"]>[number];
type ManualAddOptions = NonNullable<Awaited<ReturnType<typeof getRosterManualAddOptionsAction>>["data"]>;

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Add Booster: rosters a registered BoostingHub player's Character as a normal
 * Booster signup (never an External Booster). Player search and the Character
 * list come from the server, which applies the normal signup eligibility rules
 * against the Run's CURRENT difficulty/schedule; Add to Roster saves the slot
 * into the roster draft in one step (a legacy published roster is seeded in
 * the same transaction). Used from the Run header and the Roster tab.
 */
export function AddBoosterDialog({
  runId,
  rosterVersion,
  onClose,
  onAdded,
}: {
  runId: string;
  rosterVersion: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Results remember the query they answer, so stale or too-short queries show nothing.
  const [results, setResults] = useState<{ query: string; matches: PlayerMatch[] }>({ query: "", matches: [] });
  const [searching, setSearching] = useState(false);
  const [player, setPlayer] = useState<PlayerMatch | null>(null);
  const [options, setOptions] = useState<ManualAddOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [characterId, setCharacterId] = useState("");
  const [role, setRole] = useState<CharacterRole | "">("");

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  // Debounced server-side search; results are bounded by the server.
  useEffect(() => {
    if (player) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await searchRosterPlayersAction({ runId, query: trimmed });
      if (cancelled) return;
      setSearching(false);
      if (!result.ok) {
        setError(result.message);
        setResults({ query: trimmed, matches: [] });
        return;
      }
      setError(null);
      setResults({ query: trimmed, matches: result.data ?? [] });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, player, runId]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function choosePlayer(match: PlayerMatch) {
    setPlayer(match);
    setOptions(null);
    setCharacterId("");
    setRole("");
    setError(null);
    setLoadingOptions(true);
    const result = await getRosterManualAddOptionsAction({ runId, userId: match.id });
    setLoadingOptions(false);
    if (!result.ok || !result.data) {
      setError(result.message);
      return;
    }
    setOptions(result.data);
  }

  function clearPlayer() {
    setPlayer(null);
    setOptions(null);
    setCharacterId("");
    setRole("");
    setError(null);
  }

  const trimmedQuery = query.trim();
  const matches = trimmedQuery.length >= 2 && results.query === trimmedQuery ? results.matches : [];
  const searchAnswered = trimmedQuery.length >= 2 && results.query === trimmedQuery;

  const character = options?.eligible.find((option) => option.characterId === characterId) ?? null;

  function chooseCharacter(nextId: string) {
    setCharacterId(nextId);
    const next = options?.eligible.find((option) => option.characterId === nextId) ?? null;
    if (!next) {
      setRole("");
      return;
    }
    setRole(next.defaultRole && next.roles.includes(next.defaultRole) ? next.defaultRole : next.roles.length === 1 ? next.roles[0]! : "");
  }

  const canSubmit = Boolean(player && character && role && character.roles.includes(role as CharacterRole));

  function submit() {
    if (!player || !character || !role) return;
    setError(null);
    startTransition(async () => {
      const result = await addRosterPlayerAction({
        runId,
        version: rosterVersion,
        userId: player.id,
        characterId: character.characterId,
        role,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      onAdded();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(34rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Add Booster
        </h2>
        <p className="mt-1 text-xs text-muted">
          Add a registered BoostingHub player who did not sign up, e.g. a last-minute replacement: choose the
          player, one of their eligible characters and the role. They join the roster draft as a normal Booster —
          same access, availability and schedule rules as any signup. Players without an account go under External
          Boosters.
        </p>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}

        {player ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Player</span>
            <span className="font-medium">{player.name}</span>
            {player.discordUsername ? <span className="text-xs text-muted">@{player.discordUsername}</span> : null}
            <Button type="button" variant="ghost" className="ml-auto h-8" disabled={pending} onClick={clearPlayer}>
              Change
            </Button>
          </div>
        ) : (
          <div>
            <label htmlFor={searchId} className="mb-1 block text-xs text-muted">
              Player
            </label>
            <input
              id={searchId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              maxLength={64}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
              placeholder="Name or Discord username"
            />
            {searching ? <p className="mt-1 text-xs text-muted">Searching…</p> : null}
            {matches.length > 0 ? (
              <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Matching players">
                {matches.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/10"
                      onClick={() => void choosePlayer(match)}
                    >
                      <span className="font-medium">{match.name}</span>
                      {match.discordUsername ? <span className="text-xs text-muted">@{match.discordUsername}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : searchAnswered && !searching ? (
              <p className="mt-1 text-xs text-muted">No matching players.</p>
            ) : null}
          </div>
        )}

        {player ? (
          loadingOptions ? (
            <p className="text-xs text-muted">Loading characters…</p>
          ) : options ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Character</span>
                <select
                  value={characterId}
                  onChange={(event) => chooseCharacter(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                  disabled={options.eligible.length === 0}
                >
                  <option value="">{options.eligible.length === 0 ? "No eligible characters" : "Choose character…"}</option>
                  {options.eligible.map((option) => (
                    <option key={option.characterId} value={option.characterId}>
                      {option.characterName}-{option.realm} · {CLASS_LABELS[option.wowClass]}
                      {option.specialization ? ` (${option.specialization})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Role</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as CharacterRole)}
                  className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                  disabled={!character}
                >
                  <option value="">Choose role…</option>
                  {(character?.roles ?? []).map((option) => (
                    <option key={option} value={option}>
                      {CHARACTER_ROLE_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              {options.ineligible.length > 0 ? (
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted">Not eligible for this run:</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {options.ineligible.map((item) => (
                      <li key={item.characterId}>
                        {item.characterName}-{item.realm}: {item.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={pending || !canSubmit}>
          {pending ? "Adding…" : "Add to Roster"}
        </Button>
      </div>
    </dialog>
  );
}
