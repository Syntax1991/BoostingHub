"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { DIFFICULTY_LABELS, REGION_LABELS } from "@/lib/labels";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ClassBadge, RoleBadge } from "@/components/ui/badges";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { CharacterLifecycleButton } from "@/components/characters/character-lifecycle-button";
import { BattleNetPanel } from "@/components/characters/battle-net-panel";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type Filter = "active" | "inactive" | "all";

export function CharactersView({ data }: { data: Page }) {
  const [filter, setFilter] = useState<Filter>("active");
  const visible = useMemo(() => {
    if (filter === "all") return data.characters;
    if (filter === "active") return data.characters.filter((character) => character.isActive);
    return data.characters.filter((character) => !character.isActive);
  }, [data.characters, filter]);

  return (
    <div>
      <PageHeader
        title="Characters"
        description="World of Warcraft characters for this account. Add them manually, or optionally connect Battle.net to import and refresh."
        actions={<CharacterFormDialog mode="create" triggerLabel="Add Character" />}
      />
      <BattleNetPanel battleNet={data.battleNet} battleNetFlash={data.battleNetFlash} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <FilterButton label="Active" value="active" current={filter} onSelect={setFilter} />
        <FilterButton label="Inactive" value="inactive" current={filter} onSelect={setFilter} />
        <FilterButton label="All" value="all" current={filter} onSelect={setFilter} />
        <span className="text-xs text-muted">
          {data.activeCharacters} active · {data.totalCharacters} total
        </span>
      </div>
      <Card>
        {data.characters.length === 0 ? (
          <EmptyState
            title="No characters added yet."
            description="Add your first World of Warcraft character to start using run signups."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === "active" ? "No active characters." : "No inactive characters."}
            description="Inactive characters stay available for history. Switch the filter to see them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Character</th>
                  <th className="px-4 py-2 font-medium">Class / Spec</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">iLvl</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Booster access</th>
                  <th className="px-4 py-2 font-medium">Lockouts ({data.currentReset})</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((character) => (
                  <tr key={character.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="max-w-[200px] truncate font-medium">{character.name}</div>
                      <div className="max-w-[220px] truncate text-xs text-muted">
                        {character.realm} · {REGION_LABELS[character.region]}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ClassBadge wowClass={character.wowClass} />
                      <div className="text-xs text-muted">{character.specialization ?? "No spec"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={character.primaryRole} />
                    </td>
                    <td className="px-4 py-3">{character.itemLevel}</td>
                    <td className="px-4 py-3 text-muted">{character.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-xs">
                      {character.boosterAccess.approvals.length === 0 ? (
                        <span className="text-muted">None approved</span>
                      ) : (
                        <ul className="space-y-1">
                          {character.boosterAccess.approvals.map((approval) => (
                            <li key={`${approval.role}-${approval.difficulty}`}>
                              {approval.role} · {DIFFICULTY_LABELS[approval.difficulty]}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {character.lockouts.length === 0 ? (
                        <span className="text-muted">Clear</span>
                      ) : (
                        <ul className="space-y-1">
                          {character.lockouts.map((lockout) => (
                            <li key={`${lockout.raidName}-${lockout.difficulty}`}>
                              {DIFFICULTY_LABELS[lockout.difficulty]} ·{" "}
                              {lockout.isComplete ? "complete" : `${lockout.bossesDefeated} bosses`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {character.lastSyncedAt
                        ? `Synced ${formatDateTime(character.lastSyncedAt)}`
                        : formatDateTime(character.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/characters/${character.id}`}
                          className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                        >
                          Details
                        </Link>
                        <CharacterFormDialog
                          mode="edit"
                          triggerLabel="Edit"
                          triggerClassName="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                          initial={{
                            id: character.id,
                            name: character.name,
                            realm: character.realm,
                            region: character.region,
                            wowClass: character.wowClass,
                            specialization: character.specialization ?? "",
                            itemLevel: character.itemLevel,
                          }}
                        />
                        <CharacterLifecycleButton characterId={character.id} isActive={character.isActive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FilterButton({
  label,
  value,
  current,
  onSelect,
}: {
  label: string;
  value: Filter;
  current: Filter;
  onSelect: (value: Filter) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(value)}
      className={`h-8 rounded-md border px-3 text-sm ${
        selected ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:bg-surface-raised"
      }`}
    >
      {label}
    </button>
  );
}
