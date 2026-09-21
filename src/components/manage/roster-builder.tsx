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
  ClassIcon,
  DifficultyBadge,
  ParticipationBadge,
  OfferedRolesBadges,
  RunStatusBadge,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { WarcraftLogsLink } from "@/components/characters/warcraft-logs-link";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_COLORS,
  CLASS_LABELS,
  LOOTBUDDY_MODE_LABELS,
  LOOTBUDDY_VERIFICATION_LABELS,
} from "@/lib/labels";
import { formatContentLockoutLines } from "@/lib/run-content-lockouts";
import {
  filterWclPerformanceForGroupRole,
  compareByWclPerf,
  matchesWclPerfFilter,
  wclPerformanceRaidLineParts,
  wclPercentileColor,
  type WclPerfFilter,
  type WclPerfSort,
} from "@/lib/wcl-performance-display";
import { buildRosterSavedSelectionKey, applyRoleCopyToggle, isRoleCopyChecked as roleCopyIsChecked } from "@/components/manage/roster-staged-selection";
import type { rosterService } from "@/services/roster.service";
import type { CharacterRole, WowClass } from "@/models/enums";
import type { RaidBuffCoverage } from "@/services/roster-raid-buffs";
import {
  evaluateRaidBuffCoverage,
  resolveBuffContributorClass,
  summarizeRaidBuffCoverageByClass,
} from "@/services/roster-raid-buffs";
import { validateRosterDraft } from "@/services/roster-validation";

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

function boosterLockoutLines(signup: SignupRow): string[] {
  if (signup.participationType !== "BOOSTER" || !signup.character) return [];
  if (signup.contentSaves?.length) {
    return formatContentLockoutLines(signup.contentSaves);
  }
  return [];
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
  const [perfFilter, setPerfFilter] = useState<WclPerfFilter>("ALL");
  const [perfSort, setPerfSort] = useState<WclPerfSort>("DEFAULT");
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

  /** Live Class Buff coverage from the staged draft — updates immediately on select/deselect. */
  const liveRaidBuffCoverage = useMemo(() => {
    const participants = domainSignups
      .filter((signup) => stagedSelections.has(signup.id))
      .map((signup) => ({
        signupId: signup.id,
        userName: signup.userName,
        participationType: signup.participationType,
        lootbuddyMode: signup.lootbuddyMode,
        wowClass: resolveBuffContributorClass({
          participationType: signup.participationType,
          lootbuddyMode: signup.lootbuddyMode,
          lootbuddyClass: signup.lootbuddyClass,
          characterWowClass: signup.character?.wowClass ?? null,
        }),
        characterName: signup.character?.name ?? null,
      }));
    return evaluateRaidBuffCoverage(participants);
  }, [domainSignups, stagedSelections]);

  /** Live composition + publish validation from staged draft selections. */
  const liveValidation = useMemo(
    () =>
      validateRosterDraft({
        runStatus: data.run.status,
        selected: domainSignups
          .filter((signup) => stagedSelections.has(signup.id))
          .map((signup) => ({
            signupId: signup.id,
            userId: signup.userId,
            userName: signup.userName,
            characterName: signupDisplayName(signup),
            participationType: signup.participationType,
            selectedRole:
              signup.participationType === "LOOTBUDDY" ? null : (stagedSelections.get(signup.id) ?? null),
            status: signup.status,
            characterActive: signup.characterActive,
            boosterApproved: signup.boosterApproved,
          })),
        targets: {
          tanks: data.run.desiredTankCount,
          healers: data.run.desiredHealerCount,
          dps: data.run.desiredDpsCount,
        },
      }),
    [
      data.run.status,
      data.run.desiredTankCount,
      data.run.desiredHealerCount,
      data.run.desiredDpsCount,
      domainSignups,
      stagedSelections,
    ],
  );
  const liveComposition = liveValidation.composition;

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
    if (
      !matchesWclPerfFilter(
        signup.wclPerformance,
        signup.groupRole,
        perfFilter,
      )
    ) {
      return false;
    }
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
    const scopeRole =
      roleFilter !== "ALL" && signup.offeredRoles.includes(roleFilter as CharacterRole)
        ? (roleFilter as CharacterRole)
        : null;
    if (!matchesWclPerfFilter(signup.wclPerformance, scopeRole, perfFilter)) return false;
    return true;
  }

  function sortByPerf(signups: SignupRow[]): SignupRow[] {
    if (perfSort === "DEFAULT") return signups;
    return [...signups].sort((left, right) =>
      compareByWclPerf(
        left.wclPerformance,
        right.wclPerformance,
        left.groupRole,
        right.groupRole,
        perfSort,
      ),
    );
  }

  const filteredTanks = sortByPerf(data.groups.tanks.filter(matchesProjection));
  const filteredHealers = sortByPerf(data.groups.healers.filter(matchesProjection));
  const filteredDps = sortByPerf(data.groups.dps.filter(matchesProjection));
  const filteredLootbuddies = data.groups.lootbuddies.filter(matchesProjection);
  const uniqueFilteredBoosters = data.boosters.filter(matchesCanonicalBooster).length;

  /**
   * Role-section click: assign this groupRole, reassign if already selected as
   * another role, or deselect when clicking the currently assigned copy off.
   */
  function toggleRoleCopy(signup: SignupRow, checked: boolean) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    if (signup.status === "WITHDRAWN") return;
    // Unselected schedule-conflicted Boosters cannot be newly staged.
    if (checked && !stagedSelections.has(signup.id) && (signup.scheduleConflicts?.length ?? 0) > 0) {
      return;
    }
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
        acknowledgeWarnings: acknowledge || liveValidation.warnings.length === 0,
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
          description={`${data.run.productLabel}${
            data.run.contentSummary ? ` · ${data.run.contentSummary}` : ""
          } · ${formatDateTime(data.run.scheduledStartAt)} · Lead ${data.run.raidLeadName}`}
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
          description="Targets come from this run. Over/under is a warning, not a hard block."
        />
        <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm md:grid-cols-4">
          <CompositionMeter label="Tanks" slot={liveComposition.tanks} />
          <CompositionMeter label="Healers" slot={liveComposition.healers} />
          <CompositionMeter label="DPS" slot={liveComposition.dps} />
          <Stat label="Lootbuddies" value={String(liveComposition.lootbuddies)} />
        </div>
      </Card>

      <ClassBuffChecker coverage={liveRaidBuffCoverage} />

      <Card>
        <CardHeader title="Filters" />
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
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
          <FilterSelect
            label="Perf %"
            value={perfFilter}
            onChange={(value) => setPerfFilter(value as WclPerfFilter)}
            options={[
              { value: "ALL", label: "All" },
              { value: "HAS", label: "Has logs" },
              { value: "NONE", label: "No logs" },
              { value: "GE_25", label: "Best ≥ 25%" },
              { value: "GE_50", label: "Best ≥ 50%" },
              { value: "GE_75", label: "Best ≥ 75%" },
              { value: "GE_95", label: "Best ≥ 95%" },
            ]}
          />
          <FilterSelect
            label="Sort"
            value={perfSort}
            onChange={(value) => setPerfSort(value as WclPerfSort)}
            options={[
              { value: "DEFAULT", label: "Default" },
              { value: "BEST_DESC", label: "Best % ↓" },
              { value: "BEST_ASC", label: "Best % ↑" },
              { value: "AVG_DESC", label: "Avg % ↓" },
              { value: "AVG_ASC", label: "Avg % ↑" },
            ]}
          />
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
              . Save roster to persist.
            </p>
          ) : null}
          {liveValidation.blockers.length === 0 && liveValidation.warnings.length === 0 ? (
            <p className="text-muted">No blockers or composition warnings.</p>
          ) : null}
          {liveValidation.blockers.map((issue) => (
            <p key={`${issue.code}-${issue.signupId ?? issue.message}`} className="text-danger">
              Cannot publish — {issue.message}
            </p>
          ))}
          {liveValidation.warnings.map((issue) => (
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
                  disabled={pending || isDirty || !data.roster.canEdit || !liveValidation.canPublish}
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
            {liveComposition.tanks.selected} Tanks · {liveComposition.healers.selected} Healers ·{" "}
            {liveComposition.dps.selected} DPS · {liveComposition.lootbuddies} Lootbuddies
          </p>
          <p>
            {liveComposition.boosterTotal} Boosters · {liveComposition.lootbuddies} Lootbuddies ·{" "}
            {liveComposition.total} total selected
          </p>
          {liveValidation.warnings.length > 0 ? (
            <div className="space-y-2">
              {liveValidation.warnings.map((issue) => (
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
          {liveValidation.blockers.map((issue) => (
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
              !liveValidation.canPublish ||
              (liveValidation.warnings.length > 0 && !acknowledge)
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
  editing,
  locked,
  selected,
  assignedRole,
  onToggle,
  onAssignRole,
}: {
  signup: SignupRow;
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
  const lockoutLines = boosterLockoutLines(signup);
  const lockoutAttention = signup.contentSaves?.some((row) => row.label.attention) ?? false;
  const scheduleConflicts = signup.scheduleConflicts ?? [];
  const scheduleBlocked = !selected && scheduleConflicts.length > 0;
  const disabled = !editing || locked || signup.status === "WITHDRAWN" || scheduleBlocked;
  const needsRoleChoice = signup.participationType === "BOOSTER" && signup.offeredRoles.length > 1;
  const rowPointer = disabled ? "cursor-not-allowed" : "cursor-pointer";
  const wclForColumn = filterWclPerformanceForGroupRole(signup.wclPerformance, signup.groupRole);
  const showWcl = Boolean(character?.warcraftLogsId) || wclForColumn.length > 0;
  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-3 py-2 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-transparent"
      } ${disabled ? "opacity-70" : ""}`}
    >
      <input
        id={checkboxId}
        type="checkbox"
        className="mt-1"
        checked={selected}
        disabled={disabled}
        onChange={(event) => onToggle(signup, event.target.checked)}
      />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={checkboxId} className={`font-medium ${rowPointer}`}>
            {signupDisplayName(signup)}
          </label>
          {displayClass ? <ClassBadge wowClass={displayClass} /> : null}
          <OfferedRolesBadges roles={signup.offeredRoles} />
          <ParticipationBadge type={signup.participationType} />
          <SignupStatusBadge status={signup.status} />
          {signup.isBackup ? <span className="text-xs text-warning">Backup</span> : <span className="text-xs text-muted">Primary</span>}
        </div>
        <label
          htmlFor={checkboxId}
          className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted ${rowPointer}`}
        >
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
          {lockoutLines.length > 0 ? (
            <span className={lockoutAttention ? "text-warning" : undefined}>
              {lockoutLines.join(" · ")}
            </span>
          ) : null}
        </label>
        {selected && needsRoleChoice ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Assigned role:</span>
            <select
              aria-label={`Assigned role for ${signupDisplayName(signup)}`}
              value={assignedRole ?? ""}
              disabled={!editing || locked}
              onChange={(event) => onAssignRole(signup, event.target.value as CharacterRole)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            >
              <option value="">Choose assigned role…</option>
              {signup.offeredRoles.map((role) => (
                <option key={role} value={role}>
                  {CHARACTER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {scheduleConflicts.length > 0 ? (
          <label htmlFor={checkboxId} className={`mt-1 block space-y-0.5 text-xs text-warning ${rowPointer}`}>
            <span className="font-medium text-warning">Schedule conflict</span>
            {scheduleConflicts.map((conflict) => (
              <span key={`${conflict.source}-${conflict.message}`} className="block">
                {conflict.message}
              </span>
            ))}
          </label>
        ) : null}
        {signup.issue ? (
          <label htmlFor={checkboxId} className={`mt-1 block text-xs text-danger ${rowPointer}`}>
            {signup.issue}
          </label>
        ) : null}
      </div>
      {showWcl ? (
        <div
          className="ml-auto shrink-0 self-start text-right text-xs"
          aria-label="Warcraft Logs performance"
        >
          {character?.warcraftLogsId ? (
            <WarcraftLogsLink
              warcraftLogsId={character.warcraftLogsId}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            />
          ) : null}
          {wclForColumn.length > 0 ? (
            <div className={`space-y-0.5 text-muted ${character?.warcraftLogsId ? "mt-1" : ""}`}>
              {wclForColumn.map((segment) => (
                <div key={segment.raidId}>
                  {wclPerformanceRaidLineParts(segment).map((part, index) =>
                    part.kind === "text" ? (
                      <span key={index}>{part.text}</span>
                    ) : (
                      <span
                        key={index}
                        className="font-medium tabular-nums"
                        style={{ color: wclPercentileColor(part.value) }}
                      >
                        {part.value}%
                      </span>
                    ),
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
 * Class Buff Checker — one tile per provider class (Mage, Priest, Warlock, …).
 * Coverage means a selected composition contains that class — not that the
 * aura is cast or talented in-game.
 */
function ClassBuffChecker({ coverage }: { coverage: RaidBuffCoverage }) {
  const byClass = summarizeRaidBuffCoverageByClass(coverage);
  return (
    <Card>
      <CardHeader
        title="Class Buffs"
        description={`${byClass.coveredCount} / ${byClass.totalCount} covered${
          byClass.missingCount > 0 ? ` · ${byClass.missingCount} missing` : ""
        }. Class availability only — not live aura verification.`}
      />
      <ul className="grid gap-1.5 px-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Class buff coverage">
        {byClass.classes.map((item) => {
          const classLabel = CLASS_LABELS[item.wowClass];
          const providerName = item.providers[0]?.characterName ?? item.providers[0]?.userName ?? null;
          return (
            <li
              key={item.wowClass}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                item.covered ? "border-border" : "border-danger/40 bg-danger/5"
              }`}
            >
              <span className="mt-0.5 font-medium" aria-hidden="true">
                {item.covered ? "✓" : "✕"}
              </span>
              <ClassIcon
                wowClass={item.wowClass}
                size={20}
                className={item.covered ? undefined : "opacity-50 grayscale"}
              />
              <span className="min-w-0">
                <span className="sr-only">{item.covered ? "Covered: " : "Missing: "}</span>
                <span
                  className={item.covered ? "font-medium" : "font-medium text-danger"}
                  style={item.covered ? { color: CLASS_COLORS[item.wowClass] } : undefined}
                >
                  {classLabel}
                </span>
                {item.covered && providerName ? (
                  <span className="mt-0.5 block truncate text-xs text-muted">— {providerName}</span>
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
  options: Array<string | { value: string; label: string }>;
}) {
  const normalized = options.map((option) =>
    typeof option === "string"
      ? { value: option, label: option === "ALL" ? "All" : option.replaceAll("_", " ") }
      : option,
  );
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2"
      >
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
