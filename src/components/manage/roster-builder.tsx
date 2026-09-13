"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  prepareRosterEditAction,
  publishRosterAction,
  toggleRosterDraftSelectionAction,
} from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
import {
  ClassBadge,
  DifficultyBadge,
  ParticipationBadge,
  RoleBadge,
  RunStatusBadge,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_ABBREVIATIONS,
  LOOTBUDDY_MODE_LABELS,
  LOOTBUDDY_VERIFICATION_LABELS,
} from "@/lib/labels";
import type { rosterService } from "@/services/roster.service";
import type { WowClass } from "@/models/enums";
import type { RaidBuffCoverage } from "@/services/roster-raid-buffs";

type RosterView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
type SignupRow = RosterView["groups"]["tanks"][number];

function lootbuddyDisplayClass(signup: SignupRow): WowClass | null {
  return signup.lootbuddyClass ?? signup.character?.wowClass ?? null;
}

function signupDisplayName(signup: SignupRow): string {
  if (signup.character) {
    return `${signup.character.name}-${signup.character.realm}`;
  }
  const wowClass = lootbuddyDisplayClass(signup);
  return wowClass ? CLASS_LABELS[wowClass] : "Unknown character";
}

/** "HC 8/8 · Saved" — informational only, never a reason a candidate can't be selected or published. */
function formatRaidSave(raidSave: SignupRow["raidSave"]): string | null {
  if (!raidSave) return null;
  return `${DIFFICULTY_ABBREVIATIONS[raidSave.difficulty]} ${raidSave.bossesDefeated}/${raidSave.totalBossCount} · Saved`;
}

export function RosterBuilderView({ data, embedded = false }: { data: RosterView; embedded?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [participation, setParticipation] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [backupFilter, setBackupFilter] = useState("ALL");
  const [selectedFilter, setSelectedFilter] = useState("ALL");
  const [acknowledge, setAcknowledge] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const allSignups = useMemo(
    () => [...data.groups.tanks, ...data.groups.healers, ...data.groups.dps, ...data.groups.lootbuddies],
    [data.groups],
  );

  function matches(signup: SignupRow) {
    const haystack = `${signup.userName} ${signup.character?.name ?? ""} ${signup.character?.realm ?? ""} ${signup.lootbuddyClass ?? ""}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (participation !== "ALL" && signup.participationType !== participation) return false;
    if (roleFilter !== "ALL" && signup.role !== roleFilter) return false;
    if (backupFilter === "BACKUP" && !signup.isBackup) return false;
    if (backupFilter === "PRIMARY" && signup.isBackup) return false;
    if (selectedFilter === "SELECTED" && !signup.draftSelected) return false;
    if (selectedFilter === "UNSELECTED" && signup.draftSelected) return false;
    return true;
  }

  function toggle(signup: SignupRow, selected: boolean) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed) return;
    setError(null);
    startTransition(async () => {
      const result = await toggleRosterDraftSelectionAction({
        runId: data.run.id,
        signupId: signup.id,
        selected,
        version: data.roster.version,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function seedPublished() {
    setError(null);
    startTransition(async () => {
      const result = await prepareRosterEditAction({ runId: data.run.id, version: data.roster.version });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await publishRosterAction({
        runId: data.run.id,
        version: data.roster.version,
        acknowledgeWarnings: acknowledge || data.validation.warnings.length === 0,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  const editing = data.roster.canEdit && !data.roster.needsPublishSeed;

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {embedded ? null : (
      <Card>
        <CardHeader
          title={data.run.title}
          description={`${data.run.raidName} · ${formatDateTime(data.run.scheduledStartAt)} · Lead ${data.run.raidLeadName}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <DifficultyBadge difficulty={data.run.difficulty} />
              <RunStatusBadge status={data.run.status} />
            </div>
          }
        />
        <div className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Signups" value={`${data.run.activeSignupCount} active`} />
          <Stat label="Published selected" value={String(data.run.publishedSelectedCount)} />
          <Stat label="Backups" value={String(data.run.backupCount)} />
          <Stat
            label="Signup window"
            value={data.run.signupWindowOpen ? "Open" : "Closed"}
          />
        </div>
        {data.roster.publishedAt ? (
          <p className="border-t border-border px-4 py-3 text-xs text-muted">
            Published by {data.roster.publishedByName ?? "Unknown"} · {formatDateTime(data.roster.publishedAt)}
          </p>
        ) : null}
      </Card>
      )}

      <Card>
        <CardHeader title="Composition" description="Targets come from this run. Over/under is a warning, not a hard block." />
        <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm md:grid-cols-4">
          <CompositionMeter label="Tanks" slot={data.composition.tanks} />
          <CompositionMeter label="Healers" slot={data.composition.healers} />
          <CompositionMeter label="DPS" slot={data.composition.dps} />
          <Stat label="Lootbuddies" value={String(data.composition.lootbuddies)} />
        </div>
      </Card>

      <ClassBuffChecker coverage={data.raidBuffCoverage} />

      <Card>
        <CardHeader title="Filters" />
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              placeholder="Player or character"
            />
          </label>
          <FilterSelect label="Participation" value={participation} onChange={setParticipation} options={["ALL", "BOOSTER", "LOOTBUDDY"]} />
          <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter} options={["ALL", "TANK", "HEALER", "DPS"]} />
          <FilterSelect label="Offer" value={backupFilter} onChange={setBackupFilter} options={["ALL", "PRIMARY", "BACKUP"]} />
          <FilterSelect label="Draft" value={selectedFilter} onChange={setSelectedFilter} options={["ALL", "SELECTED", "UNSELECTED"]} />
        </div>
      </Card>

      <SignupSection
        title="Tanks"
        empty="No tank signups"
        signups={data.groups.tanks.filter(matches)}
        allSignups={allSignups}
        editing={editing}
        pending={pending}
        onToggle={toggle}
      />
      <SignupSection
        title="Healers"
        empty="No healer signups"
        signups={data.groups.healers.filter(matches)}
        allSignups={allSignups}
        editing={editing}
        pending={pending}
        onToggle={toggle}
      />
      <SignupSection
        title="DPS"
        empty="No DPS signups"
        signups={data.groups.dps.filter(matches)}
        allSignups={allSignups}
        editing={editing}
        pending={pending}
        onToggle={toggle}
      />
      <SignupSection
        title="Lootbuddies"
        empty="No lootbuddy signups"
        signups={data.groups.lootbuddies.filter(matches)}
        allSignups={allSignups}
        editing={editing}
        pending={pending}
        onToggle={toggle}
      />

      <Card>
        <CardHeader title="Roster validation" />
        <div className="space-y-2 px-4 py-4 text-sm">
          {data.validation.blockers.length === 0 && data.validation.warnings.length === 0 ? (
            <p className="text-muted">No blockers or composition warnings.</p>
          ) : null}
          {data.validation.blockers.map((issue) => (
            <p key={`${issue.code}-${issue.signupId ?? issue.message}`} className="text-danger">
              Cannot publish — {issue.message}
            </p>
          ))}
          {data.validation.warnings.map((issue) => (
            <p key={`${issue.code}-${issue.message}`} className="text-warning">
              Warning — {issue.message}
            </p>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            {data.roster.needsPublishSeed ? (
              <Button type="button" disabled={pending} onClick={seedPublished}>
                {pending ? "Loading…" : "Edit Published Roster"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={pending || !data.roster.canEdit || !data.validation.canPublish}
                onClick={() => dialogRef.current?.showModal()}
              >
                Publish Roster
              </Button>
            )}
          </div>
        </div>
      </Card>

      <dialog
        ref={dialogRef}
        aria-labelledby="publish-title"
        className="fixed left-1/2 top-[8vh] m-0 w-[min(32rem,calc(100vw-2rem))] max-h-[min(84vh,40rem)] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="publish-title" className="text-base font-semibold" tabIndex={-1}>
            Publish roster
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm">
          <p>
            Publishing will mark draft-selected signups as SELECTED, mark remaining active candidates as
            NOT_SELECTED, lock self-withdrawal for selected players on a published run, and set the run to
            PUBLISHED.
          </p>
          <p>
            {data.summary.tanks} Tanks · {data.summary.healers} Healers · {data.summary.dps} DPS ·{" "}
            {data.summary.lootbuddies} Lootbuddies
          </p>
          <p>
            {data.summary.boosters} Boosters · {data.summary.lootbuddies} Lootbuddies · {data.summary.total}{" "}
            total selected
          </p>
          {data.validation.warnings.length > 0 ? (
            <div className="space-y-2">
              {data.validation.warnings.map((issue) => (
                <p key={issue.message} className="text-warning">
                  {issue.message}
                </p>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(event) => setAcknowledge(event.target.checked)}
                />
                Publish with these composition warnings
              </label>
            </div>
          ) : null}
          {data.validation.blockers.map((issue) => (
            <p key={issue.message} className="text-danger">
              {issue.message}
            </p>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              pending ||
              !data.validation.canPublish ||
              (data.validation.warnings.length > 0 && !acknowledge)
            }
            onClick={publish}
          >
            {pending ? "Publishing…" : "Confirm publish"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}

function SignupSection({
  title,
  empty,
  signups,
  allSignups,
  editing,
  pending,
  onToggle,
}: {
  title: string;
  empty: string;
  signups: SignupRow[];
  allSignups: SignupRow[];
  editing: boolean;
  pending: boolean;
  onToggle: (signup: SignupRow, selected: boolean) => void;
}) {
  const grouped = groupByUser(signups);
  return (
    <Card>
      <CardHeader title={title} description={`${signups.length} signup${signups.length === 1 ? "" : "s"}`} />
      {signups.length === 0 ? (
        <EmptyState title={empty} description="New signups appear here after refresh while the window is open." />
      ) : (
        <ul className="divide-y divide-border">
          {grouped.map((group) => (
            <li key={group.userId} className="px-4 py-3">
              <p className="mb-2 text-sm font-semibold">{group.userName}</p>
              <div className="space-y-2">
                {group.signups.map((signup) => (
                  <SignupRowCard
                    key={signup.id}
                    signup={signup}
                    extras={allSignups.filter((item) => item.userId === signup.userId && item.id !== signup.id)}
                    editing={editing}
                    pending={pending}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SignupRowCard({
  signup,
  extras,
  editing,
  pending,
  onToggle,
}: {
  signup: SignupRow;
  extras: SignupRow[];
  editing: boolean;
  pending: boolean;
  onToggle: (signup: SignupRow, selected: boolean) => void;
}) {
  const checkboxId = `signup-${signup.id}`;
  const character = signup.character;
  const displayClass = lootbuddyDisplayClass(signup);
  return (
    <div className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
      <input
        id={checkboxId}
        type="checkbox"
        className="mt-1"
        checked={signup.draftSelected}
        disabled={!editing || pending || signup.status === "WITHDRAWN"}
        onChange={(event) => onToggle(signup, event.target.checked)}
      />
      <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{signupDisplayName(signup)}</span>
          {displayClass ? <ClassBadge wowClass={displayClass} /> : null}
          {signup.role ? <RoleBadge role={signup.role} /> : null}
          <ParticipationBadge type={signup.participationType} />
          <SignupStatusBadge status={signup.status} />
          {signup.isBackup ? <span className="text-xs text-warning">Backup</span> : <span className="text-xs text-muted">Primary</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {character ? (
            <span>
              {typeof character.itemLevel === "number" ? character.itemLevel : "Unknown"} ilvl ·{" "}
              {character.specialization ?? character.primaryRole}
            </span>
          ) : null}
          {signup.participationType === "BOOSTER" && signup.boosterApproved ? (
            <AccessBadge status="APPROVED" />
          ) : null}
          {signup.participationType === "LOOTBUDDY" ? (
            <span>
              {signup.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[signup.lootbuddyMode] : "Lootbuddy"}
              {signup.lootbuddyVerification && signup.lootbuddyVerification !== "NONE"
                ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[signup.lootbuddyVerification]}`
                : ""}
            </span>
          ) : null}
          {formatRaidSave(signup.raidSave) ? <span>{formatRaidSave(signup.raidSave)}</span> : null}
        </div>
        {extras.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            <span>Also offered:</span>
            {extras.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!editing || pending || item.status === "WITHDRAWN"}
                onClick={(event) => {
                  event.preventDefault();
                  onToggle(item, true);
                }}
                className="rounded border border-border px-1.5 py-0.5 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                title={`Select ${item.character?.name ?? "this offer"} instead`}
              >
                {item.character?.name ?? "character"}
                {item.role ? ` (${CHARACTER_ROLE_LABELS[item.role]})` : ` (${item.participationType})`}
              </button>
            ))}
          </div>
        ) : null}
        {signup.issue ? (
          <p className="mt-1 text-xs text-danger">{signup.issue}</p>
        ) : null}
      </label>
    </div>
  );
}

function groupByUser(signups: SignupRow[]) {
  const order: Array<{ userId: string; userName: string; signups: SignupRow[] }> = [];
  for (const signup of signups) {
    const existing = order.find((group) => group.userId === signup.userId);
    if (existing) {
      existing.signups.push(signup);
    } else {
      order.push({ userId: signup.userId, userName: signup.userName, signups: [signup] });
    }
  }
  return order;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

/**
 * Derived Class Buff coverage for the CURRENT draft selection.
 * Coverage means a selected composition contains a class that can provide the
 * buff — not that the aura is cast or talented in-game.
 */
function ClassBuffChecker({ coverage }: { coverage: RaidBuffCoverage }) {
  return (
    <Card>
      <CardHeader
        title="Class Buffs"
        description={`${coverage.coveredCount} / ${coverage.totalCount} covered${
          coverage.missingCount > 0 ? ` · ${coverage.missingCount} missing` : ""
        }. Class availability only — not live aura verification.`}
      />
      <ul className="grid gap-1.5 px-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Class buff coverage">
        {coverage.buffs.map((buff) => {
          const providerLabel = buff.providerClass ? CLASS_LABELS[buff.providerClass] : null;
          return (
            <li
              key={buff.id}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                buff.covered ? "border-border" : "border-danger/40 bg-danger/5"
              }`}
            >
              <span className="mt-0.5 font-medium" aria-hidden="true">
                {buff.covered ? "✓" : "✕"}
              </span>
              <span className="min-w-0">
                <span className="sr-only">{buff.covered ? "Covered: " : "Missing: "}</span>
                <span className={buff.covered ? "font-medium" : "font-medium text-danger"}>{buff.name}</span>
                {buff.covered && providerLabel ? (
                  <span className="mt-0.5 block truncate text-xs text-muted">— {providerLabel}</span>
                ) : (
                  <span className="mt-0.5 block text-xs text-danger">Missing</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CompositionMeter({
  label,
  slot,
}: {
  label: string;
  slot: { selected: number; target: number; delta: number };
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium">
        {slot.selected} / {slot.target}
      </p>
      {slot.delta > 0 ? <p className="text-xs text-warning">{slot.delta} over target</p> : null}
      {slot.delta < 0 ? <p className="text-xs text-warning">{Math.abs(slot.delta)} under target</p> : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "ALL" ? "All" : option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
