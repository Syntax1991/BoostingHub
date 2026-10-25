"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, CLASS_COLORS, REGION_LABELS } from "@/lib/labels";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { LockoutProgressFromRows } from "@/components/ui/lockout-progress";
import { BoostingRoleBadges, ClassIcon } from "@/components/ui/badges";
import { RoleIcon } from "@/components/ui/ops-icons";
import { SpecIcon } from "@/components/ui/spec-icon";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { DiscordBoosterApplicationCta } from "@/components/characters/discord-booster-application-cta";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { CharacterLifecycleButton } from "@/components/characters/character-lifecycle-button";
import { DeleteCharacterButton } from "@/components/characters/delete-character-button";
import { BattleNetPanel } from "@/components/characters/battle-net-panel";
import { WarcraftLogsLink } from "@/components/characters/warcraft-logs-link";
import { LinkWarcraftLogsButton } from "@/components/characters/link-warcraft-logs-button";
import { FindMissingWarcraftLogsButton } from "@/components/characters/find-missing-warcraft-logs-button";
import { WeeklyAvailabilityDialog } from "@/components/characters/weekly-availability-dialog";
import { formatWeeklyAvailabilityButtonLabel } from "@/lib/weekly-availability-display";
import { additionalPlayableSpecLabels } from "@/lib/character-roster-metadata";
import { rosterRoleForSpecialization } from "@/lib/wow-specializations";
import { cn } from "@/lib/cn";
import {
  BATTLENET_IDENTITY_REPAIR_HINT,
  BATTLENET_IDENTITY_REPAIR_TITLE,
  BLIZZARD_PROFILE_UNAVAILABLE_HINT,
  BLIZZARD_PROFILE_UNAVAILABLE_TITLE,
  BLIZZARD_SYNC_STALE_HINT,
} from "@/lib/blizzard/sync-state";
import { RAID_DIFFICULTIES, type CharacterRole, type RaidDifficulty } from "@/models/enums";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type Filter = "active" | "inactive" | "all";
type CharacterRow = Page["characters"][number];

const DIFF_PILL: Record<RaidDifficulty, string> = {
  NORMAL: "N",
  HEROIC: "H",
  MYTHIC: "M",
};

const DIFF_PILL_ON: Record<RaidDifficulty, string> = {
  NORMAL: "bg-success/20 text-success ring-success/35",
  HEROIC: "bg-info/20 text-info ring-info/35",
  MYTHIC: "bg-mythic/20 text-mythic ring-mythic/40",
};

/**
 * Desktop identity columns — shared by header + every Character row.
 *
 * Applied via `style.gridTemplateColumns` (not a Tailwind `grid-cols-[…]`
 * arbitrary). Long arbitrary tracks with nested `minmax(...,…)` never made
 * it into compiled CSS here: only `display:grid` applied, so every cell
 * stacked in one implicit column (headers vertical, Active floating mid-row).
 *
 * Order: Active · Character · Spec · Role · Offspec · Difficulty · WCL · Sync · Actions
 */
export const DESKTOP_IDENTITY_COLUMNS =
  "3.75rem minmax(12rem, 1.45fr) minmax(7.5rem, 0.75fr) 6.75rem 6.75rem 5.75rem 5rem 7.5rem 5.75rem";

/** Shared by header + row — same padding, same tracks, same vertical centering. */
const DESKTOP_IDENTITY_CLASS = "grid items-center gap-x-3 px-3";
const DESKTOP_IDENTITY_STYLE = { gridTemplateColumns: DESKTOP_IDENTITY_COLUMNS } as const;

/** Every identity cell: same vertical center; no per-column self-align overrides. */
function DesktopIdentityCell({
  children,
  end = false,
  className,
}: {
  children: ReactNode;
  end?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 items-center self-center",
        end && "justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

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
    <PageWorkspace width="wide">
      <PageHeader
        title="Characters"
        description="WoW characters for this account. Add looks up Blizzard; optionally connect Battle.net."
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {hasMissingActiveWarcraftLogs ? <FindMissingWarcraftLogsButton /> : null}
            <CharacterFormDialog mode="create" triggerLabel="Add Character" />
          </div>
        }
      />
      <BattleNetPanel battleNet={data.battleNet} battleNetFlash={data.battleNetFlash} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Boosting roles</span>
          <BoostingRoleBadges roles={data.boostingRoles} emptyLabel="None yet" />
        </div>
        {data.boostingRoles.isBooster || data.boostingRoles.discordRaidBooster ? null : (
          <DiscordBoosterApplicationCta discordTicketUrl={data.discordTicketUrl} />
        )}
      </div>

      <section aria-label="Character list" className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterButton label="Active" value="active" current={filter} onSelect={setFilter} />
            <FilterButton label="Inactive" value="inactive" current={filter} onSelect={setFilter} />
            <FilterButton label="All" value="all" current={filter} onSelect={setFilter} />
          </div>
          <p className="text-xs text-muted">
            {data.activeCharacters} active · {data.totalCharacters} total
          </p>
        </div>

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
          <>
            {/* Desktop: cohesive Character unit = identity + lockout */}
            <div className="hidden md:block">
              <div
                className={cn("mb-1.5 text-[11px] leading-none text-muted/80", DESKTOP_IDENTITY_CLASS)}
                style={DESKTOP_IDENTITY_STYLE}
                data-characters-desktop-identity="header"
              >
                <DesktopIdentityCell>Active</DesktopIdentityCell>
                <DesktopIdentityCell>Character</DesktopIdentityCell>
                <DesktopIdentityCell>Spec</DesktopIdentityCell>
                <DesktopIdentityCell>Role</DesktopIdentityCell>
                <DesktopIdentityCell>Offspec</DesktopIdentityCell>
                <DesktopIdentityCell>Difficulty</DesktopIdentityCell>
                <DesktopIdentityCell>WCL</DesktopIdentityCell>
                <DesktopIdentityCell>Sync</DesktopIdentityCell>
                <DesktopIdentityCell end>Actions</DesktopIdentityCell>
              </div>
              <ul className="flex flex-col gap-2">
                {visible.map((character) => (
                  <li
                    key={character.id}
                    className="overflow-hidden rounded-lg border border-border/45 bg-surface/55"
                  >
                    <CharacterDesktopUnit
                      character={character}
                      currentLockoutRaids={data.currentLockoutRaids ?? []}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {/* Mobile cards — same unit language */}
            <ul className="flex flex-col gap-2.5 md:hidden">
              {visible.map((character) => (
                <li key={character.id}>
                  <CharacterMobileCard
                    character={character}
                    currentLockoutRaids={data.currentLockoutRaids ?? []}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PageWorkspace>
  );
}

function CharacterDesktopUnit({
  character,
  currentLockoutRaids,
}: {
  character: CharacterRow;
  currentLockoutRaids: Page["currentLockoutRaids"];
}) {
  return (
    <>
      {/* LEVEL 1 — identity grid (same columns + cell shell as header) */}
      <div
        className={cn("py-2", DESKTOP_IDENTITY_CLASS)}
        style={DESKTOP_IDENTITY_STYLE}
        data-characters-desktop-identity="row"
      >
        <DesktopIdentityCell>
          <CharacterLifecycleButton characterId={character.id} isActive={character.isActive} variant="switch" />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <CharacterIdentityCell character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <SpecCell character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <RoleWithLabel role={character.primaryRole} />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <OffspecCell character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <DifficultyPills character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell>
          <WclProfileCell character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell className="truncate text-[11px] leading-none text-muted">
          <SyncCell character={character} />
        </DesktopIdentityCell>
        <DesktopIdentityCell end className="gap-1">
          <Link
            href={`/characters/${character.id}`}
            className="inline-flex h-7 items-center rounded-md border border-border/70 px-2 text-xs text-foreground/90 hover:bg-surface-raised"
          >
            Open
          </Link>
          <CharacterOverflow character={character} />
        </DesktopIdentityCell>
      </div>
      {/* LEVEL 2 — full-width equal lockout raid groups */}
      <div className="border-t border-border/30 bg-surface-raised/20 px-3 py-2">
        <LockoutProgressFromRows
          rows={character.lockouts}
          currentRaids={currentLockoutRaids}
          layout="rail"
        />
      </div>
    </>
  );
}

/** Class + Name-Realm + ilvl; region secondary. Spec lives in SpecCell on desktop. */
function CharacterIdentityCell({
  character,
  showSpec = false,
}: {
  character: CharacterRow;
  showSpec?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ClassIcon wowClass={character.wowClass} size={28} />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[15px] font-semibold leading-tight" style={{ color: CLASS_COLORS[character.wowClass] }}>
            {character.name}
            <span className="font-normal text-foreground/75">-{character.realm}</span>
          </span>
          {typeof character.itemLevel === "number" ? (
            <span className="shrink-0 rounded-md bg-surface-raised/80 px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
              {character.itemLevel} ilvl
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span>{REGION_LABELS[character.region]}</span>
          {showSpec && character.specialization ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 text-foreground/75">
                <SpecIcon wowClass={character.wowClass} specialization={character.specialization} size={14} />
                {character.specialization}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SpecCell({ character }: { character: CharacterRow }) {
  if (!character.specialization) {
    return <span className="text-[13px] leading-none text-muted">—</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] leading-none text-foreground/90">
      <SpecIcon wowClass={character.wowClass} specialization={character.specialization} size={18} />
      <span className="truncate">{character.specialization}</span>
    </span>
  );
}

function RoleWithLabel({ role }: { role: CharacterRole }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] leading-none text-foreground/90">
      <RoleIcon role={role} size={18} />
      <span className="truncate">{CHARACTER_ROLE_LABELS[role]}</span>
    </span>
  );
}

/** One compact offspec — preferred playable spec, else preferred offspec role. */
function OffspecCell({ character }: { character: CharacterRow }) {
  const playable = additionalPlayableSpecLabels({
    specialization: character.specialization,
    wowClass: character.wowClass,
    playableSpecs: character.playableSpecs,
  });
  const primary = playable[0];
  if (primary) {
    const role = rosterRoleForSpecialization(character.wowClass, primary);
    const extra = playable.length > 1 ? ` (+${playable.length - 1})` : "";
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1 text-[13px] leading-none text-foreground/85"
        title={playable.length > 1 ? `Also: ${playable.slice(1).join(", ")}` : primary}
      >
        <SpecIcon wowClass={character.wowClass} specialization={primary} size={16} />
        <span className="truncate">
          {primary}
          {extra}
        </span>
        {role ? <span className="sr-only">{CHARACTER_ROLE_LABELS[role]}</span> : null}
      </span>
    );
  }

  const offRole = (character.offspecRoles ?? []).find((role) => role !== character.primaryRole);
  if (offRole) {
    return <RoleWithLabel role={offRole} />;
  }

  return <span className="text-sm text-muted">—</span>;
}

/** Compact N/H/M from weekly availability — lit when that difficulty is available. */
function DifficultyPills({ character }: { character: CharacterRow }) {
  const unavailable = new Set(character.weeklyAvailability.unavailableDifficulties ?? []);
  const fullyAvailable = character.weeklyAvailability.status === "AVAILABLE";
  return (
    <div className="flex items-center gap-1" title="Weekly availability by difficulty">
      {RAID_DIFFICULTIES.map((difficulty) => {
        const on = fullyAvailable || !unavailable.has(difficulty);
        return (
          <span
            key={difficulty}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ring-1",
              on ? DIFF_PILL_ON[difficulty] : "bg-surface text-muted/50 ring-border",
            )}
            title={`${DIFF_PILL[difficulty]} ${on ? "available" : "unavailable"}`}
          >
            {DIFF_PILL[difficulty]}
          </span>
        );
      })}
    </div>
  );
}

function CharacterMobileCard({
  character,
  currentLockoutRaids,
}: {
  character: CharacterRow;
  currentLockoutRaids: Page["currentLockoutRaids"];
}) {
  const [openLockouts, setOpenLockouts] = useState(true);
  return (
    <div className="overflow-hidden rounded-lg border border-border/45 bg-surface/55">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <CharacterLifecycleButton characterId={character.id} isActive={character.isActive} variant="switch" />
        <div className="min-w-0 flex-1">
          <CharacterIdentityCell character={character} showSpec />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <RoleWithLabel role={character.primaryRole} />
            <OffspecCell character={character} />
            <DifficultyPills character={character} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <SyncCell character={character} />
            <WclProfileCell character={character} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/characters/${character.id}`}
            className="inline-flex h-7 items-center rounded-md border border-border/70 px-2 text-xs"
          >
            Open
          </Link>
          <CharacterOverflow character={character} />
        </div>
      </div>
      <div className="border-t border-border/30 bg-surface-raised/20 px-3 py-2">
        <button
          type="button"
          className="mb-1 text-[11px] font-medium text-muted hover:text-foreground"
          onClick={() => setOpenLockouts((value) => !value)}
        >
          {openLockouts ? "Hide lockouts" : "Show lockouts"}
        </button>
        {openLockouts ? (
          <LockoutProgressFromRows
            rows={character.lockouts}
            currentRaids={currentLockoutRaids}
            layout="stack"
          />
        ) : null}
        <div className="mt-2">
          <AvailabilityCell character={character} />
        </div>
      </div>
    </div>
  );
}

function WclProfileCell({ character }: { character: CharacterRow }) {
  if (character.warcraftLogsId?.trim()) {
    return (
      <WarcraftLogsLink
        warcraftLogsId={character.warcraftLogsId}
        label="Profile"
        className="inline-flex items-center gap-1 text-[11px] text-info/90 hover:underline"
      />
    );
  }
  return (
    <LinkWarcraftLogsButton characterId={character.id} label="Find WCL" pendingLabel="…" />
  );
}

/**
 * Overflow actions must NOT mount dialogs inside OverflowMenu `node` items.
 * Closing the menu unmounted those hosts mid-click, so Edit / Availability /
 * Delete never stayed open. Menu items call onSelect → hidden always-mounted
 * triggers (same CharacterFormDialog / WeeklyAvailabilityDialog / … as before).
 */
function CharacterOverflow({ character }: { character: CharacterRow }) {
  const availabilityTriggerRef = useRef<HTMLButtonElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const lifecycleTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const unavailable = character.weeklyAvailability.status === "UNAVAILABLE";

  return (
    <>
      <OverflowMenu
        label={`More actions for ${character.name}`}
        items={[
          {
            id: "availability",
            label: "Availability",
            onSelect: () => availabilityTriggerRef.current?.click(),
          },
          {
            id: "edit",
            label: "Edit",
            onSelect: () => editTriggerRef.current?.click(),
          },
          {
            id: "lifecycle",
            label: character.isActive ? "Deactivate" : "Activate",
            onSelect: () => lifecycleTriggerRef.current?.click(),
          },
          {
            id: "delete",
            label: "Delete",
            danger: true,
            onSelect: () => deleteTriggerRef.current?.click(),
          },
        ]}
      />
      {/* Always mounted — keep dialogs alive after the menu panel closes.
          Off-screen (not pointer-events-none): modal <dialog> must remain clickable. */}
      <span className="fixed -left-[9999px] top-0">
        <WeeklyAvailabilityDialog
          characterId={character.id}
          characterName={character.name}
          weeklyAvailability={character.weeklyAvailability}
          triggerRef={availabilityTriggerRef}
          triggerLabel={formatWeeklyAvailabilityButtonLabel(
            character.weeklyAvailability.unavailableDifficulties,
          )}
          triggerClassName={cn(
            "inline-flex h-7 items-center rounded-md border border-border bg-transparent px-2 text-xs font-medium",
            unavailable ? "text-[#f0b4b4]" : "text-[#b7e0c0]",
          )}
        />
        <CharacterFormDialog
          mode="edit"
          triggerRef={editTriggerRef}
          triggerLabel="Edit"
          triggerClassName="h-8 rounded-md border border-border px-2 text-xs"
          initial={{
            id: character.id,
            name: character.name,
            realm: character.realm,
            region: character.region,
            wowClass: character.wowClass,
            specialization: character.specialization ?? "",
            playableSpecs: character.playableSpecs ?? [],
            offspecRoles: character.offspecRoles ?? [],
            itemLevel: character.itemLevel,
          }}
        />
        <CharacterLifecycleButton
          characterId={character.id}
          isActive={character.isActive}
          buttonRef={lifecycleTriggerRef}
        />
        <DeleteCharacterButton
          characterId={character.id}
          characterLabel={`${character.name}-${character.realm}`}
          mode="owner"
          buttonRef={deleteTriggerRef}
        />
      </span>
    </>
  );
}

function SyncCell({ character }: { character: CharacterRow }) {
  if (character.battleNetRepairNeeded) {
    return (
      <span className="cursor-help text-warning" title={BATTLENET_IDENTITY_REPAIR_HINT}>
        {BATTLENET_IDENTITY_REPAIR_TITLE}
      </span>
    );
  }
  if (character.blizzardSyncState.kind === "PROFILE_UNAVAILABLE") {
    return (
      <span className="cursor-help text-warning" title={BLIZZARD_PROFILE_UNAVAILABLE_HINT}>
        {BLIZZARD_PROFILE_UNAVAILABLE_TITLE}
      </span>
    );
  }
  if (character.blizzardSyncState.kind === "AWAITING_FIRST_SYNC") {
    return <span>Awaiting sync</span>;
  }
  if (character.lastSyncedAt) {
    return (
      <span title={formatDateTime(character.lastSyncedAt)}>
        Synced
        {character.blizzardSyncState.kind === "STALE" ? (
          <span className="ml-1 cursor-help text-warning" title={BLIZZARD_SYNC_STALE_HINT}>
            · failing
          </span>
        ) : null}
      </span>
    );
  }
  return <span>{formatDateTime(character.updatedAt)}</span>;
}

function AvailabilityCell({
  character,
  compact = false,
}: {
  character: CharacterRow;
  compact?: boolean;
}) {
  const unavailable = character.weeklyAvailability.status === "UNAVAILABLE";
  return (
    <span className={compact ? undefined : "inline-flex flex-col gap-0.5"}>
      {!compact ? <span className="text-[11px] text-muted">Availability</span> : null}
      <WeeklyAvailabilityDialog
        characterId={character.id}
        characterName={character.name}
        weeklyAvailability={character.weeklyAvailability}
        triggerLabel={formatWeeklyAvailabilityButtonLabel(
          character.weeklyAvailability.unavailableDifficulties,
        )}
        triggerClassName={cn(
          "inline-flex h-7 items-center rounded-md border border-border bg-transparent px-2 text-xs font-medium transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          unavailable ? "text-[#f0b4b4]" : "text-[#b7e0c0]",
        )}
      />
    </span>
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
          ? "rounded-md border border-accent/45 bg-surface-raised px-2.5 py-1 text-xs font-medium text-foreground"
          : "rounded-md border border-border/70 px-2.5 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}
