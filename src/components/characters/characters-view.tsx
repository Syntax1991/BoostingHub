"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { formatCompactMultiRaidLockoutProgress } from "@/lib/lockout-display";
import { DIFFICULTY_LABELS, REGION_LABELS } from "@/lib/labels";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ClassBadge, RoleBadge } from "@/components/ui/badges";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { CharacterLifecycleButton } from "@/components/characters/character-lifecycle-button";
import { BattleNetPanel } from "@/components/characters/battle-net-panel";
import { WarcraftLogsLink } from "@/components/characters/warcraft-logs-link";
import { LinkWarcraftLogsButton } from "@/components/characters/link-warcraft-logs-button";
import { FindMissingWarcraftLogsButton } from "@/components/characters/find-missing-warcraft-logs-button";
import { WeeklyAvailabilityDialog } from "@/components/characters/weekly-availability-dialog";
import { formatWeeklyAvailabilityButtonLabel } from "@/lib/weekly-availability-display";
import { cn } from "@/lib/cn";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type Filter = "active" | "inactive" | "all";
type CharacterRow = Page["characters"][number];

export function CharactersView({ data }: { data: Page }) {
  const [filter, setFilter] = useState<Filter>("active");
  const visible = useMemo(() => {
    if (filter === "all") return data.characters;
    if (filter === "active") return data.characters.filter((character) => character.isActive);
    return data.characters.filter((character) => !character.isActive);
  }, [data.characters, filter]);

  const hasMissingActiveWarcraftLogs = data.characters.some(
    (character) => character.isActive && !(character.warcraftLogsId?.trim()),
  );

  return (
    <div>
      <PageHeader
        title="Characters"
        description="World of Warcraft characters for this account. Add Character looks up Blizzard; optionally connect Battle.net to import and refresh."
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {hasMissingActiveWarcraftLogs ? <FindMissingWarcraftLogsButton /> : null}
            <CharacterFormDialog mode="create" triggerLabel="Add Character" />
          </div>
        }
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
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Character</th>
                  <th className="px-4 py-2 font-medium">Class / Spec</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">iLvl</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Account access</th>
                  <th className="px-4 py-2 font-medium">
                    Lockouts
                    {data.currentLockoutRaids?.length
                      ? ` (${data.currentLockoutRaids.map((raid) => raid.name).join(" · ")})`
                      : ""}
                  </th>
                  <th className="px-4 py-2 font-medium">Availability</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((character) => (
                  <tr key={character.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{character.name}</div>
                      <div className="text-xs text-muted">
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
                    <td className="px-4 py-3">
                      {typeof character.itemLevel === "number" ? character.itemLevel : "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-muted">{character.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-xs">
                      {character.boosterAccess.approvals.length === 0 ? (
                        <span className="text-muted">None approved</span>
                      ) : (
                        <ul className="space-y-1">
                          {character.boosterAccess.approvals.map((approval) => (
                            <li key={approval.difficulty}>{DIFFICULTY_LABELS[approval.difficulty]}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {formatCompactMultiRaidLockoutProgress(
                        character.lockouts,
                        data.currentLockoutRaids ?? [],
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AvailabilityCell character={character} />
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
                        {character.warcraftLogsId?.trim() ? (
                          <WarcraftLogsLink warcraftLogsId={character.warcraftLogsId} label="WCL" />
                        ) : (
                          <LinkWarcraftLogsButton
                            characterId={character.id}
                            label="Find WCL"
                            pendingLabel="Looking up…"
                          />
                        )}
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

function AvailabilityCell({ character }: { character: CharacterRow }) {
  const unavailable = character.weeklyAvailability.status === "UNAVAILABLE";
  return (
    <WeeklyAvailabilityDialog
      characterId={character.id}
      characterName={character.name}
      weeklyAvailability={character.weeklyAvailability}
      triggerLabel={formatWeeklyAvailabilityButtonLabel(
        character.weeklyAvailability.unavailableDifficulties,
      )}
      triggerClassName={cn(
        "inline-flex h-8 items-center rounded-md border border-border bg-transparent px-2 text-xs font-medium transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        unavailable ? "text-[#f0b4b4]" : "text-[#b7e0c0]",
      )}
    />
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
  const active = current === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={
        active
          ? "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
          : "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-raised"
      }
    >
      {label}
    </button>
  );
}
