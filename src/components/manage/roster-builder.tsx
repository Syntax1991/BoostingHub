"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  prepareRosterEditAction,
  publishRosterAction,
  saveRosterDraftAction,
} from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
import {
  ClassBadge,
  DifficultyBadge,
  ParticipationBadge,
  OfferedRolesBadges,
  RunStatusBadge,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  LOOTBUDDY_MODE_LABELS,
  LOOTBUDDY_VERIFICATION_LABELS,
} from "@/lib/labels";
import { formatTargetRaidLockoutLabel } from "@/lib/raid-lockout-label";
import { buildRosterSavedSelectionKey, applyRoleCopyToggle, isRoleCopyChecked as roleCopyIsChecked } from "@/components/manage/roster-staged-selection";
import type { rosterService } from "@/services/roster.service";
import type { CharacterRole, WowClass } from "@/models/enums";
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

function boosterLockoutLabel(
  signup: SignupRow,
  run: Pick<RosterView["run"], "difficulty" | "totalBossCount" | "lootType">,
): ReturnType<typeof formatTargetRaidLockoutLabel> | null {
  if (signup.participationType !== "BOOSTER" || !signup.character) return null;
  return formatTargetRaidLockoutLabel({
    difficulty: run.difficulty,
    totalBossCount: run.totalBossCount,
    raidSave: signup.raidSave,
    lootType: run.lootType,
  });
}

/** Canonical unique BOOSTERs + lootbuddies — never flatten role projections. */
function domainSignupsFrom(data: RosterView): SignupRow[] {
  return data.boosters.concat(data.groups.lootbuddies);
}

/** A draft slot is a signup plus the role the raid lead assigned it, so both take part in dirty detection. */
type StagedSelections = Map<string, CharacterRole | null>;

function selectionEntries(selections: StagedSelections): string[] {
  return [...selections].map(([signupId, role]) => `${signupId}:${role ?? ""}`);
}

function selectionKey(selections: StagedSelections) {
  return selectionEntries(selections).sort().join(",");
}

function collectSavedSelections(data: RosterView): StagedSelections {
  const selections: StagedSelections = new Map();
  for (const signup of domainSignupsFrom(data)) {
    if (signup.draftSelected) {
      selections.set(signup.id, signup.selectedRole);
    }
  }
  return selections;
}

/**
 * Remount the editor only when the authoritative server draft snapshot changes
 * (version and/or saved selected ids). Harmless parent rerenders keep local staged
 * edits and filters because the key stays stable.
 */
export function RosterBuilderView({ data, embedded = false }: { data: RosterView; embedded?: boolean }) {
  const savedSelections = collectSavedSelections(data);
  const savedSelectionKey = buildRosterSavedSelectionKey(data.roster.version, selectionEntries(savedSelections));
  return (
    <RosterBuilderEditor
      key={savedSelectionKey}
      data={data}
      embedded={embedded}
      savedSelections={savedSelections}
    />
  );
}

function RosterBuilderEditor({
  data,
  embedded = false,
  savedSelections,
}: {
  data: RosterView;
  embedded?: boolean;
  savedSelections: StagedSelections;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [participation, setParticipation] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [backupFilter, setBackupFilter] = useState("ALL");
  const [selectedFilter, setSelectedFilter] = useState("ALL");
  const [acknowledge, setAcknowledge] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const domainSignups = useMemo(() => domainSignupsFrom(data), [data]);
  const [stagedSelections, setStagedSelections] = useState<StagedSelections>(() => new Map(savedSelections));

  const isDirty = selectionKey(stagedSelections) !== selectionKey(savedSelections);
  const unsavedChangeCount = useMemo(() => {
    let count = 0;
    for (const [id, role] of stagedSelections) {
      if (!savedSelections.has(id) || savedSelections.get(id) !== role) count += 1;
    }
    for (const id of savedSelections.keys()) {
      if (!stagedSelections.has(id)) count += 1;
    }
    return count;
  }, [stagedSelections, savedSelections]);

  function isStagedSelected(signupId: string) {
    return stagedSelections.has(signupId);
  }

  function stagedRole(signupId: string) {
    return stagedSelections.get(signupId) ?? null;
  }

  /** Checked highlight follows the assigned role copy, not every projection of a selected signup. */
  function isRoleCopyChecked(signup: SignupRow) {
    return roleCopyIsChecked({
      stagedRole: stagedSelections.has(signup.id) ? stagedRole(signup.id) : undefined,
      groupRole: signup.groupRole,
    });
  }

  function matchesProjection(signup: SignupRow) {
    const haystack = `${signup.userName} ${signup.character?.name ?? ""} ${signup.character?.realm ?? ""} ${signup.lootbuddyClass ?? ""}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (participation !== "ALL" && signup.participationType !== participation) return false;
    if (roleFilter !== "ALL") {
      // Prefer the matching role section; hide lootbuddies and other role buckets.
      if (signup.groupRole == null || signup.groupRole !== roleFilter) return false;
    }
    if (backupFilter === "BACKUP" && !signup.isBackup) return false;
    if (backupFilter === "PRIMARY" && signup.isBackup) return false;
    const staged = isStagedSelected(signup.id);
    if (selectedFilter === "SELECTED") {
      // Draft-selected identity: only the assigned role copy (or lootbuddy) counts as selected.
      if (!isRoleCopyChecked(signup)) return false;
    }
    if (selectedFilter === "UNSELECTED" && staged) return false;
    return true;
  }

  /** Identity-level match for unique Booster totals — never sum projected rows. */
  function matchesCanonicalBooster(signup: SignupRow) {
    const haystack = `${signup.userName} ${signup.character?.name ?? ""} ${signup.character?.realm ?? ""}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (participation === "LOOTBUDDY") return false;
    if (participation !== "ALL" && participation !== "BOOSTER") return false;
    if (roleFilter !== "ALL" && !signup.offeredRoles.includes(roleFilter as CharacterRole)) return false;
    if (backupFilter === "BACKUP" && !signup.isBackup) return false;
    if (backupFilter === "PRIMARY" && signup.isBackup) return false;
    const staged = isStagedSelected(signup.id);
    if (selectedFilter === "SELECTED" && !staged) return false;
    if (selectedFilter === "UNSELECTED" && staged) return false;
    return true;
  }

  const filteredTanks = data.groups.tanks.filter(matchesProjection);
  const filteredHealers = data.groups.healers.filter(matchesProjection);
  const filteredDps = data.groups.dps.filter(matchesProjection);
  const filteredLootbuddies = data.groups.lootbuddies.filter(matchesProjection);
  const uniqueFilteredBoosters = data.boosters.filter(matchesCanonicalBooster).length;

  /**
   * Role-section click: assign this groupRole, reassign if already selected as
   * another role, or deselect when clicking the currently assigned copy off.
   */
  function toggleRoleCopy(signup: SignupRow, checked: boolean) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    if (signup.status === "WITHDRAWN") return;
    setError(null);
    setErrorCode(null);
    setStagedSelections((previous) => {
      const replaceBoosterSignupIds =
        signup.participationType === "BOOSTER"
          ? domainSignups
              .filter(
                (other) =>
                  other.userId === signup.userId &&
                  other.participationType === "BOOSTER" &&
                  other.id !== signup.id,
              )
              .map((other) => other.id)
          : [];
      return applyRoleCopyToggle({
        staged: previous,
        signupId: signup.id,
        groupRole: signup.groupRole,
        checked,
        replaceBoosterSignupIds,
      });
    });
  }

  /** Reassigning a selected slot's role is its own edit — it never deselects the slot. */
  function assignRole(signup: SignupRow, role: CharacterRole) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    setError(null);
    setErrorCode(null);
    setStagedSelections((previous) => {
      if (!previous.has(signup.id)) return previous;
      const next = new Map(previous);
      next.set(signup.id, role);
      return next;
    });
  }

  function discardChanges() {
    setError(null);
    setErrorCode(null);
    setStagedSelections(new Map(savedSelections));
  }

  function saveRoster() {
    if (!isDirty || pending) return;
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await saveRosterDraftAction({
        runId: data.run.id,
        version: data.roster.version,
        selections: [...stagedSelections].map(([signupId, selectedRole]) => ({ signupId, selectedRole })),
      });
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      router.refresh();
    });
  }

  function seedPublished() {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await prepareRosterEditAction({ runId: data.run.id, version: data.roster.version });
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      router.refresh();
    });
  }

  function publish() {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await publishRosterAction({
        runId: data.run.id,
        version: data.roster.version,
        acknowledgeWarnings: acknowledge || data.validation.warnings.length === 0,
      });
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  const editing = data.roster.canEdit && !data.roster.needsPublishSeed;
  const togglesLocked = pending;

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-danger">
          <p>{error}</p>
          {errorCode === "ROSTER_ALREADY_CHANGED" ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => router.refresh()}>
              Refresh roster
            </Button>
          ) : null}
        </div>
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
        <CardHeader
          title="Composition"
          description={
            isDirty
              ? "Saved draft state. Save roster to recalculate composition, buffs, and validation."
              : "Targets come from this run. Over/under is a warning, not a hard block."
          }
        />
        <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm md:grid-cols-4">
          <CompositionMeter label="Tanks" slot={data.composition.tanks} />
          <CompositionMeter label="Healers" slot={data.composition.healers} />
          <CompositionMeter label="DPS" slot={data.composition.dps} />
          <Stat label="Lootbuddies" value={String(data.composition.lootbuddies)} />
        </div>
      </Card>

      <ClassBuffChecker coverage={data.raidBuffCoverage} dirty={isDirty} />

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

      <Card>
        <CardHeader
          title="Boosters"
          description={`${uniqueFilteredBoosters} signup${uniqueFilteredBoosters === 1 ? "" : "s"}`}
        />
        <p className="border-t border-border px-4 py-3 text-xs text-muted">
          Unique Booster signups. Multi-role offers appear in every matching role section below — section
          counts are role offers and may sum higher than this total.
        </p>
      </Card>

      <SignupSection
        title="Tanks"
        empty="No tank signups"
        signups={filteredTanks}
        run={data.run}
        editing={editing}
        locked={togglesLocked}
        isRoleCopyChecked={isRoleCopyChecked}
        stagedRole={stagedRole}
        onToggle={toggleRoleCopy}
        onAssignRole={assignRole}
      />
      <SignupSection
        title="Healers"
        empty="No healer signups"
        signups={filteredHealers}
        run={data.run}
        editing={editing}
        locked={togglesLocked}
        isRoleCopyChecked={isRoleCopyChecked}
        stagedRole={stagedRole}
        onToggle={toggleRoleCopy}
        onAssignRole={assignRole}
      />
      <SignupSection
        title="DPS"
        empty="No DPS signups"
        signups={filteredDps}
        run={data.run}
        editing={editing}
        locked={togglesLocked}
        isRoleCopyChecked={isRoleCopyChecked}
        stagedRole={stagedRole}
        onToggle={toggleRoleCopy}
        onAssignRole={assignRole}
      />
      <SignupSection
        title="Lootbuddies"
        empty="No lootbuddy signups"
        signups={filteredLootbuddies}
        run={data.run}
        editing={editing}
        locked={togglesLocked}
        isRoleCopyChecked={isRoleCopyChecked}
        stagedRole={stagedRole}
        onToggle={toggleRoleCopy}
        onAssignRole={assignRole}
      />

      <Card>
        <CardHeader title="Roster validation" />
        <div className="space-y-2 px-4 py-4 text-sm">
          {isDirty ? (
            <p className="text-warning">
              Unsaved roster changes
              {unsavedChangeCount > 0 ? ` · ${unsavedChangeCount} change${unsavedChangeCount === 1 ? "" : "s"}` : ""}
              . Save roster to recalculate composition, buffs, and validation.
            </p>
          ) : null}
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
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {data.roster.needsPublishSeed ? (
              <Button type="button" disabled={pending} onClick={seedPublished}>
                {pending ? "Loading…" : "Edit Published Roster"}
              </Button>
            ) : (
              <>
                <Button type="button" disabled={pending || !editing || !isDirty} onClick={saveRoster}>
                  {pending && isDirty ? "Saving…" : "Save Roster"}
                </Button>
                {isDirty ? (
                  <Button type="button" variant="ghost" disabled={pending} onClick={discardChanges}>
                    Discard changes
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={pending || isDirty || !data.roster.canEdit || !data.validation.canPublish}
                  onClick={() => dialogRef.current?.showModal()}
                >
                  Publish Roster
                </Button>
              </>
            )}
          </div>
          {isDirty && !data.roster.needsPublishSeed ? (
            <p className="text-xs text-muted">Save roster changes before publishing.</p>
          ) : null}
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
              isDirty ||
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
  run,
  editing,
  locked,
  isRoleCopyChecked,
  stagedRole,
  onToggle,
  onAssignRole,
}: {
  title: string;
  empty: string;
  signups: SignupRow[];
  run: Pick<RosterView["run"], "difficulty" | "totalBossCount" | "lootType">;
  editing: boolean;
  locked: boolean;
  isRoleCopyChecked: (signup: SignupRow) => boolean;
  stagedRole: (signupId: string) => CharacterRole | null;
  onToggle: (signup: SignupRow, selected: boolean) => void;
  onAssignRole: (signup: SignupRow, role: CharacterRole) => void;
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
                    key={`${signup.id}:${signup.groupRole ?? "lootbuddy"}`}
                    signup={signup}
                    run={run}
                    editing={editing}
                    locked={locked}
                    selected={isRoleCopyChecked(signup)}
                    assignedRole={stagedRole(signup.id)}
                    onToggle={onToggle}
                    onAssignRole={onAssignRole}
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
  run,
  editing,
  locked,
  selected,
  assignedRole,
  onToggle,
  onAssignRole,
}: {
  signup: SignupRow;
  run: Pick<RosterView["run"], "difficulty" | "totalBossCount" | "lootType">;
  editing: boolean;
  locked: boolean;
  selected: boolean;
  assignedRole: CharacterRole | null;
  onToggle: (signup: SignupRow, selected: boolean) => void;
  onAssignRole: (signup: SignupRow, role: CharacterRole) => void;
}) {
  const checkboxId = `signup-${signup.id}-${signup.groupRole ?? "lootbuddy"}`;
  const character = signup.character;
  const displayClass = lootbuddyDisplayClass(signup);
  const lockout = boosterLockoutLabel(signup, run);
  const disabled = !editing || locked || signup.status === "WITHDRAWN";
  const needsRoleChoice = signup.participationType === "BOOSTER" && signup.offeredRoles.length > 1;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-transparent"
      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <input
        id={checkboxId}
        type="checkbox"
        className="mt-1"
        checked={selected}
        disabled={disabled}
        onChange={(event) => onToggle(signup, event.target.checked)}
      />
      <span className="min-w-0 flex-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{signupDisplayName(signup)}</span>
          {displayClass ? <ClassBadge wowClass={displayClass} /> : null}
          <OfferedRolesBadges roles={signup.offeredRoles} />
          <ParticipationBadge type={signup.participationType} />
          <SignupStatusBadge status={signup.status} />
          {signup.isBackup ? <span className="text-xs text-warning">Backup</span> : <span className="text-xs text-muted">Primary</span>}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
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
          {lockout ? (
            <span className={lockout.attention ? "text-warning" : undefined}>{lockout.text}</span>
          ) : null}
        </span>
        {selected && needsRoleChoice ? (
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Assigned role:</span>
            <select
              aria-label={`Assigned role for ${signupDisplayName(signup)}`}
              value={assignedRole ?? ""}
              disabled={!editing || locked}
              onChange={(event) => onAssignRole(signup, event.target.value as CharacterRole)}
              onClick={(event) => event.stopPropagation()}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            >
              <option value="">Choose assigned role…</option>
              {signup.offeredRoles.map((role) => (
                <option key={role} value={role}>
                  {CHARACTER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </span>
        ) : null}
        {signup.issue ? (
          <span className="mt-1 block text-xs text-danger">{signup.issue}</span>
        ) : null}
      </span>
    </label>
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
function ClassBuffChecker({ coverage, dirty }: { coverage: RaidBuffCoverage; dirty: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Class Buffs"
        description={`${coverage.coveredCount} / ${coverage.totalCount} covered${
          coverage.missingCount > 0 ? ` · ${coverage.missingCount} missing` : ""
        }. Class availability only — not live aura verification.${
          dirty ? " Save roster to recalculate." : ""
        }`}
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
