"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareRosterEditAction,
  publishRosterAction,
  repostRosterAction,
  requestLateFillHelpAction,
  saveRosterDraftAction,
  syncRosterCharactersAction,
  updateRosterAction,
} from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
import { AddBoosterEntryDialog, type AddBoosterMode } from "@/components/manage/add-booster-entry-dialog";
import { RosterBuilderDialog, type RosterBuilderMode } from "@/components/manage/roster-builder-dialog";
import { RosterReplacementDialog, type ReplacementTarget } from "@/components/manage/roster-replacement-dialog";
import { RosterUpdateDiff } from "@/components/manage/roster-update-diff";
import {
  SIGNUP_GROUP_BY_LABELS,
  SIGNUP_GROUP_BY_MODES,
  buildSignupGroups,
  getSignupGroupByServerSnapshot,
  getSignupGroupBySnapshot,
  setSignupGroupBy,
  signupGroupCountLabel,
  subscribeSignupGroupBy,
} from "@/components/manage/roster-signup-grouping";
import { RosterBossPlanPanel } from "@/components/manage/roster-boss-plan-panel";
import {
  bossExceptionsPayload,
  bossPlanIsDirty,
  evaluateLiveBossPlan,
} from "@/components/manage/roster-boss-plan-editor";
import { ROSTER_ATTENTION_ANCHOR } from "@/components/runs/run-preflight-panel";
import { SIGNUP_TILE_TONE_CLASSES, signupTileTone } from "@/lib/signup-tile-tone";
import { resolveRosterActions } from "@/components/manage/roster-actions";
import {
  ClassIcon,
  DifficultyBadge,
  RunStatusBadge,
} from "@/components/ui/badges";
import {
  BuffCoveredIcon,
  BuffMissingIcon,
  DraftCheckIcon,
  LockoutIcon,
  LootbuddyIcon,
  QuietOkIcon,
  ReplaceIcon,
  RoleIcon,
  WarningIcon,
} from "@/components/ui/ops-icons";
import { ChooseSpecOption } from "@/components/manage/choose-spec-option";
import { rosterSlotWarningReasons } from "@/components/manage/roster-slot-warning";
import { SpecIcon } from "@/components/ui/spec-icon";
import { WclBestLink } from "@/components/ui/wcl-best-link";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/datetime";
import { runDetailPath } from "@/lib/run-routes";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_COLORS,
  CLASS_LABELS,
} from "@/lib/labels";
import {
  formatContentLockoutTooltip,
  formatSignupTileLockoutShort,
} from "@/lib/run-content-lockouts";
import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { diffBossPlans, diffRoster, type RosterDiffMember } from "@/lib/roster-diff";
import { describeSlotBossPlan, type RosterBossException } from "@/lib/roster-boss-plan";
import {
  rosterReplacementReasons,
  withdrawnPickOpenRole,
  type ReplacementCandidate,
} from "@/lib/roster-replacement";
import { countRolesByBucket } from "@/lib/roster-role-buckets";
import {
  resolveDisplaySpecForSelectedRole,
  resolveOfferedSpecs,
  type OfferedSpecChoice,
} from "@/lib/signup-offered-specs";
import {
  signupMatchesRoleFilter,
  tileVisibleSpecs,
  uniqueSignupTiles,
} from "@/lib/signup-tile-invariants";
import { resolveSignupTileWclBest } from "@/lib/wcl-spec-performance";
import {
  compareByWclPerf,
  matchesWclPerfFilter,
  type WclPerfFilter,
  type WclPerfSort,
  type WclPerformanceRaidSegment,
} from "@/lib/wcl-performance-display";
import { buildRosterSavedSelectionKey, applyRoleCopyToggle, applyUnassignedDpsToggle, isRoleCopyChecked as roleCopyIsChecked, isUnassignedDpsCopyChecked } from "@/components/manage/roster-staged-selection";
import type { rosterService } from "@/services/roster.service";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import type { RaidBuffCoverage } from "@/services/roster-raid-buffs";
import {
  evaluateRaidBuffCoverage,
  resolveBuffContributorClass,
  summarizeRaidBuffCoverageByClass,
} from "@/services/roster-raid-buffs";
import { validateRosterDraft } from "@/services/roster-validation";
import {
  confirmedWarningsFor,
  RosterWarningConfirmDialog,
  warningDialogItemsFromPending,
  type RosterWarningDialogItem,
} from "@/components/manage/roster-warning-confirm-dialog";
import {
  unacknowledgedWarnings,
  type ConfirmedRosterWarning,
  type PendingRosterSelectionWarning,
} from "@/services/roster-selection-risk";

type RosterView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;

/** Dense responsive Signups grid — the same in every Group by mode. */
const SIGNUP_GRID_CLASS =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 [&>li]:h-[54px]";
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

/** Canonical unique BOOSTERs + lootbuddies — never flatten role projections. */
function domainSignupsFrom(data: RosterView): SignupRow[] {
  return data.boosters.concat(data.groups.lootbuddies);
}

/** A draft slot is a signup plus the role the raid lead assigned it, so both take part in dirty detection. */
type StagedSelections = Map<string, CharacterRole | null>;
/** Client-only chosen specialization per signup (domain persists selectedRole only). */
type StagedSpecs = Map<string, string | null>;

/** Presentation-only roster group cell (does not change domain storage). */
type DraftRosterSlot = {
  signup: SignupRow | null;
  role: CharacterRole | null;
  /** Chosen playable spec for display; null when unknown / lootbuddy / external. */
  specialization: string | null;
  name: string;
  wowClass: WowClass | null;
  /** Why the slot needs attention, one line per reason; empty = no warning icon. */
  warningReasons: string[];
  /** An existing warning a replacement fixes (saved / conflict / inactive / revoked) — shows Find replacement. */
  replaceable?: boolean;
  /** Compact boss exceptions ("Boss 5–6: Synpriest-Antonidas · Healer"); null = plays every boss as rostered. */
  bossPlan?: string | null;
  external?: boolean;
};

function signupOfferedSpecInput(signup: SignupRow) {
  return {
    wowClass: signup.character?.wowClass ?? null,
    primarySpecialization: signup.character?.specialization ?? null,
    playableSpecs: signup.character?.playableSpecs ?? [],
    offeredRoles: signup.assignableRoles.length > 0 ? signup.assignableRoles : signup.offeredRoles,
  };
}

function collectInitialStagedSpecs(data: RosterView, selections: StagedSelections): StagedSpecs {
  const specs: StagedSpecs = new Map();
  for (const signup of domainSignupsFrom(data)) {
    if (!selections.has(signup.id)) continue;
    const role = selections.get(signup.id) ?? null;
    specs.set(signup.id, resolveDisplaySpecForSelectedRole(signupOfferedSpecInput(signup), role));
  }
  return specs;
}

/** Pack draft slots into Group 1–4 for Raid Hub–style density (view-only layout). */
function packDraftIntoGroups(
  slots: DraftRosterSlot[],
  groupCount: number,
  slotsPerGroup: number,
): Array<Array<DraftRosterSlot | null>> {
  const groups: Array<Array<DraftRosterSlot | null>> = Array.from({ length: groupCount }, () =>
    Array.from({ length: slotsPerGroup }, () => null),
  );
  slots.forEach((slot, index) => {
    const groupIndex = index % groupCount;
    const rowIndex = Math.floor(index / groupCount);
    if (rowIndex < slotsPerGroup) {
      groups[groupIndex][rowIndex] = slot;
    }
  });
  return groups;
}

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
export function RosterBuilderView({
  data,
  embedded = false,
  preflightAttentionCount = 0,
  afterContext = null,
}: {
  data: RosterView;
  embedded?: boolean;
  /** From Run Detail preflight — status chip only (no checklist on Roster). */
  preflightAttentionCount?: number;
  /** Rendered after Validation/Preflight chips and before Signups (Roster tab composition). */
  afterContext?: ReactNode;
}) {
  const savedSelections = collectSavedSelections(data);
  const savedSelectionKey = buildRosterSavedSelectionKey(data.roster.version, selectionEntries(savedSelections));
  return (
    <RosterBuilderEditor
      key={savedSelectionKey}
      data={data}
      embedded={embedded}
      savedSelections={savedSelections}
      preflightAttentionCount={preflightAttentionCount}
      afterContext={afterContext}
    />
  );
}

function RosterBuilderEditor({
  data,
  embedded = false,
  savedSelections,
  preflightAttentionCount = 0,
  afterContext = null,
}: {
  data: RosterView;
  embedded?: boolean;
  savedSelections: StagedSelections;
  preflightAttentionCount?: number;
  afterContext?: ReactNode;
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
  /** Open shared Add Booster entry: a registered player or the External Boosters list. */
  const [addBoosterMode, setAddBoosterMode] = useState<AddBoosterMode | null>(null);
  /** Which confirmation the roster dialog shows: first Publish, Update, or an explicit repost. */
  const [dialogMode, setDialogMode] = useState<"publish" | "update" | "repost">("publish");
  const dialogRef = useRef<HTMLDialogElement>(null);
  /**
   * Selection warnings (saved / fully-saved lockout) the Raid Lead explicitly
   * confirmed in this editor session, by signup. Request-scoped: sent with
   * Save / Update and re-validated by the server; never persisted.
   */
  const [confirmedWarnings, setConfirmedWarnings] = useState<Map<string, ConfirmedRosterWarning[]>>(
    () => new Map(),
  );
  /**
   * Open warning confirmation: a single pick awaiting "Select anyway", or the
   * server's current warnings after it rejected a Save / Update whose
   * acknowledgements were missing or stale.
   */
  const [warningPrompt, setWarningPrompt] = useState<
    | {
        kind: "pick";
        signup: SignupRow;
        items: RosterWarningDialogItem[];
        /** Spec-aware tile pick — applied on confirm instead of groupRole copy. */
        pendingRole?: CharacterRole;
        pendingSpec?: string | null;
        /** Find replacement: the draft slot this pick replaces (removed on confirm only). */
        replacesSignupId?: string;
      }
    | { kind: "server"; action: "save" | "update"; pending: PendingRosterSelectionWarning[] }
    | null
  >(null);

  /** Open Find replacement / Fill slot picker. */
  const [replacement, setReplacement] = useState<{ target: ReplacementTarget; role: ConcreteCharacterRole } | null>(
    null,
  );
  /** Open Auto Build on top of the current draft (Fill gaps) or from the signups only (Build). */
  const [builderMode, setBuilderMode] = useState<RosterBuilderMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Signups "Group by" (presentation only), remembered in this browser; None on the server render. */
  const groupBy = useSyncExternalStore(
    subscribeSignupGroupBy,
    getSignupGroupBySnapshot,
    getSignupGroupByServerSnapshot,
  );

  const domainSignups = useMemo(() => domainSignupsFrom(data), [data]);

  // Preflight "Find replacements / Fill gaps / Sync Characters" link here; the
  // page scrolls inside the app shell, so bring the roster section into view.
  useEffect(() => {
    if (window.location.hash === `#${ROSTER_ATTENTION_ANCHOR}`) {
      document.getElementById(ROSTER_ATTENTION_ANCHOR)?.scrollIntoView({ block: "start" });
    }
  }, []);
  const [stagedSelections, setStagedSelections] = useState<StagedSelections>(() => new Map(savedSelections));
  const [stagedSpecs, setStagedSpecs] = useState<StagedSpecs>(() => collectInitialStagedSpecs(data, savedSelections));
  // Edited on the External side of Add Booster (saved on their own); counted here as saved.
  const externalBoosters = data.roster.externalBoosters;

  /**
   * Boss plan (behind ROSTER_BOSS_EXCEPTIONS_ENABLED): staged DRAFT exceptions
   * on top of the staged roster. The payload drops rows the staged roster made
   * meaningless; Save / Update send it as the full set.
   */
  const bossPlanEditable = data.bossPlan.enabled && data.bossPlan.bosses.length > 0;
  const [stagedBossExceptions, setStagedBossExceptions] = useState<RosterBossException[]>(() => [
    ...data.bossPlan.draft,
  ]);
  const [bossPlanOpen, setBossPlanOpen] = useState(false);
  const bossPayload = useMemo(
    () =>
      bossExceptionsPayload({
        exceptions: stagedBossExceptions,
        staged: stagedSelections,
        signups: domainSignups,
        bosses: data.bossPlan.bosses,
      }),
    [stagedBossExceptions, stagedSelections, domainSignups, data.bossPlan.bosses],
  );
  const bossPlanDirty = bossPlanEditable && bossPlanIsDirty(bossPayload, data.bossPlan.draft);
  const characterLabelBySignupId = useMemo(
    () => new Map(domainSignups.map((signup) => [signup.id, signupDisplayName(signup)])),
    [domainSignups],
  );

  const isDirty = selectionKey(stagedSelections) !== selectionKey(savedSelections) || bossPlanDirty;

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
    const externals = externalBoosters.map((booster) => ({
      signupId: `external:${booster.id}`,
      userName: booster.name,
      participationType: booster.participationType,
      lootbuddyMode: null,
      wowClass: booster.wowClass,
      characterName: booster.name,
    }));
    return evaluateRaidBuffCoverage([...participants, ...externals]);
  }, [domainSignups, stagedSelections, externalBoosters]);

  /** Live composition + publish validation from staged draft selections. */
  const defaultLiveValidation = useMemo(
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
            requiresConcreteDpsChoice:
              signup.participationType === "BOOSTER" &&
              signup.offeredRoles.includes("DPS") &&
              signup.assignableRoles.filter((role) => role === "MELEE_DPS" || role === "RANGED_DPS").length > 1 &&
              (stagedSelections.get(signup.id) == null ||
                !isConcreteCharacterRole(stagedSelections.get(signup.id) as CharacterRole)),
            status: signup.status,
            characterActive: signup.characterActive,
            boosterApproved: signup.boosterApproved,
          })),
        targets: {
          tanks: data.run.desiredTankCount,
          healers: data.run.desiredHealerCount,
          dps: data.run.desiredDpsCount,
          lootbuddies: data.run.desiredLootbuddyCount,
        },
        externalBoosters,
      }),
    [
      data.run.status,
      data.run.desiredTankCount,
      data.run.desiredHealerCount,
      data.run.desiredDpsCount,
      data.run.desiredLootbuddyCount,
      domainSignups,
      stagedSelections,
      externalBoosters,
    ],
  );
  /** Per-boss warnings and hard issues of the staged boss plan (none without exceptions). */
  const bossEvaluation = useMemo(
    () =>
      evaluateLiveBossPlan({
        bosses: data.bossPlan.bosses,
        payload: bossPayload,
        staged: stagedSelections,
        signups: domainSignups,
        externalRoles: externalBoosters
          .filter((booster) => booster.participationType === "BOOSTER")
          .map((booster) => booster.role),
        targets: { tanks: data.run.desiredTankCount, healers: data.run.desiredHealerCount, dps: data.run.desiredDpsCount },
        lootType: data.run.lootType,
      }),
    [
      data.bossPlan.bosses,
      bossPayload,
      stagedSelections,
      domainSignups,
      externalBoosters,
      data.run.desiredTankCount,
      data.run.desiredHealerCount,
      data.run.desiredDpsCount,
      data.run.lootType,
    ],
  );
  // Same merge as the server's roster validation: boss issues block Publish /
  // Update, boss warnings join the acknowledgeable warnings.
  const liveValidation =
    bossEvaluation.issues.length === 0 && bossEvaluation.warnings.length === 0
      ? defaultLiveValidation
      : {
          ...defaultLiveValidation,
          canPublish: defaultLiveValidation.canPublish && bossEvaluation.issues.length === 0,
          blockers: [
            ...defaultLiveValidation.blockers,
            ...bossEvaluation.issues.map((issue) => ({ code: issue.code, message: issue.message, signupId: issue.slotSignupId })),
          ],
          warnings: [
            ...defaultLiveValidation.warnings,
            ...bossEvaluation.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
          ],
        };
  const liveComposition = defaultLiveValidation.composition;

  const roleBreakdown = useMemo(() => {
    const stagedRoles = domainSignups
      .filter((signup) => stagedSelections.has(signup.id) && signup.participationType === "BOOSTER")
      .map((signup) => stagedSelections.get(signup.id) ?? null);
    const externalRoles = externalBoosters
      .filter((booster) => booster.participationType === "BOOSTER")
      .map((booster) => booster.role);
    const counts = countRolesByBucket([...stagedRoles, ...externalRoles]);
    const unresolvedHistoric = domainSignups.filter((signup) => {
      if (!stagedSelections.has(signup.id) || signup.participationType !== "BOOSTER") return false;
      if ((stagedSelections.get(signup.id) ?? null) != null) return false;
      const dpsChoices = signup.assignableRoles.filter((role) => role === "MELEE_DPS" || role === "RANGED_DPS");
      return signup.offeredRoles.includes("DPS") && dpsChoices.length > 1;
    }).length;
    return { ...counts, legacyDps: counts.legacyDps + unresolvedHistoric };
  }, [domainSignups, stagedSelections, externalBoosters]);

  function isStagedSelected(signupId: string) {
    return stagedSelections.has(signupId);
  }

  function stagedRole(signupId: string) {
    return stagedSelections.get(signupId) ?? null;
  }

  /** Checked highlight follows the assigned role copy, not every projection of a selected signup. */
  function isRoleCopyChecked(signup: SignupRow) {
    const staged = stagedSelections.has(signup.id) ? stagedRole(signup.id) : undefined;
    if (signup.unassignedDps) return isUnassignedDpsCopyChecked(staged);
    return roleCopyIsChecked({
      stagedRole: staged,
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
    if (
      roleFilter !== "ALL" &&
      !signupMatchesRoleFilter(signup.assignableRoles, roleFilter as CharacterRole)
    ) {
      return false;
    }
    if (backupFilter === "BACKUP" && !signup.isBackup) return false;
    if (backupFilter === "PRIMARY" && signup.isBackup) return false;
    const staged = isStagedSelected(signup.id);
    if (selectedFilter === "SELECTED" && !staged) return false;
    if (selectedFilter === "UNSELECTED" && staged) return false;
    const scopeRole =
      roleFilter !== "ALL" && signupMatchesRoleFilter(signup.assignableRoles, roleFilter as CharacterRole)
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

  /** Unified signup grid — one tile per signup identity (not per role projection). */
  const gridSignups = useMemo(() => {
    const boosters = uniqueSignupTiles(data.boosters.filter(matchesCanonicalBooster));
    const lootbuddies =
      participation === "BOOSTER" ? [] : uniqueSignupTiles(data.groups.lootbuddies.filter(matchesProjection));
    return sortByPerf([...boosters, ...lootbuddies]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter helpers close over filter state
  }, [
    data.boosters,
    data.groups.lootbuddies,
    search,
    participation,
    roleFilter,
    backupFilter,
    selectedFilter,
    perfFilter,
    perfSort,
    stagedSelections,
  ]);

  const rosterCapacity =
    data.run.desiredTankCount +
    data.run.desiredHealerCount +
    data.run.desiredDpsCount +
    data.run.desiredLootbuddyCount;

  const draftSlots = useMemo(() => {
    const roleOrder: Record<string, number> = {
      TANK: 0,
      HEALER: 1,
      MELEE_DPS: 2,
      RANGED_DPS: 3,
      DPS: 4,
    };
    const slots: DraftRosterSlot[] = [];
    for (const signup of domainSignups) {
      if (!stagedSelections.has(signup.id)) continue;
      const role = stagedSelections.get(signup.id) ?? null;
      slots.push({
        signup,
        role,
        specialization: stagedSpecs.get(signup.id) ?? null,
        name: signupDisplayName(signup),
        wowClass: lootbuddyDisplayClass(signup) ?? signup.character?.wowClass ?? null,
        warningReasons: rosterSlotWarningReasons(signup),
        replaceable: rosterReplacementReasons(signup).length > 0,
        bossPlan: describeSlotBossPlan({
          exceptions: bossPayload.filter((row) => row.slotSignupId === signup.id),
          bosses: data.bossPlan.bosses,
          characterLabelBySignupId,
        }),
      });
    }
    for (const booster of externalBoosters) {
      slots.push({
        signup: null,
        role: booster.role,
        specialization: null,
        name: `@${booster.name}`,
        wowClass: booster.wowClass,
        warningReasons: [],
        external: true,
      });
    }
    slots.sort((a, b) => (roleOrder[a.role ?? ""] ?? 9) - (roleOrder[b.role ?? ""] ?? 9));
    return slots;
  }, [domainSignups, stagedSelections, stagedSpecs, externalBoosters, bossPayload, data.bossPlan.bosses, characterLabelBySignupId]);

  const draftSlotCount = draftSlots.length;
  const draftGroups = useMemo(() => packDraftIntoGroups(draftSlots, 4, Math.max(5, Math.ceil(rosterCapacity / 4) || 5)), [draftSlots, rosterCapacity]);

  /** Both paths save on their own and reload the roster, so unsaved draft edits must be saved first. */
  function openAddBooster(mode: AddBoosterMode) {
    if (!data.roster.canEdit || isDirty || pending) return;
    setAddBoosterMode(mode);
  }

  function deselectSignup(signup: SignupRow) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    setError(null);
    setErrorCode(null);
    setStagedSelections((previous) => {
      if (!previous.has(signup.id)) return previous;
      const next = new Map(previous);
      next.delete(signup.id);
      return next;
    });
    setStagedSpecs((previous) => {
      if (!previous.has(signup.id)) return previous;
      const next = new Map(previous);
      next.delete(signup.id);
      return next;
    });
  }

  /**
   * Role-section click: assign this groupRole, reassign if already selected as
   * another role, or deselect when clicking the currently assigned copy off.
   */
  function toggleRoleCopy(signup: SignupRow, checked: boolean) {
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    if (signup.status === "WITHDRAWN") return;
    // Runs within 2h / weekly unavailable: hard block — no override.
    if (checked && !stagedSelections.has(signup.id) && (signup.scheduleConflicts?.length ?? 0) > 0) {
      return;
    }
    // WARNING: NEW pick with saved lockout needs confirmation. Conflict stays blocked above.
    if (checked && !stagedSelections.has(signup.id)) {
      const unconfirmed = warningsNeedingConfirmation(signup);
      if (unconfirmed.length > 0) {
        setWarningPrompt({
          kind: "pick",
          signup,
          items: [{ key: signup.id, characterLabel: signupDisplayName(signup), warnings: unconfirmed }],
        });
        return;
      }
    }
    stageRoleCopy(signup, checked);
  }

  /** Warnings of this signup the Raid Lead still has to confirm before it can be newly selected. */
  function warningsNeedingConfirmation(signup: SignupRow) {
    if (savedSelections.has(signup.id) || signup.status === "SELECTED") return [];
    if (signup.selectionRisk?.level !== "WARNING") return [];
    return unacknowledgedWarnings(signup.selectionRisk, confirmedWarnings.get(signup.id) ?? []);
  }

  function stageRoleCopy(signup: SignupRow, checked: boolean) {
    setError(null);
    setErrorCode(null);
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
    setStagedSelections((previous) => {
      if (signup.unassignedDps) {
        return applyUnassignedDpsToggle({
          staged: previous,
          signupId: signup.id,
          checked,
          replaceBoosterSignupIds,
        });
      }
      return applyRoleCopyToggle({
        staged: previous,
        signupId: signup.id,
        groupRole: signup.groupRole,
        checked,
        replaceBoosterSignupIds,
      });
    });
    setStagedSpecs((previous) => {
      const next = new Map(previous);
      for (const otherId of replaceBoosterSignupIds) {
        if (otherId !== signup.id) next.delete(otherId);
      }
      if (!checked) {
        next.delete(signup.id);
        return next;
      }
      const role = signup.unassignedDps ? null : signup.groupRole;
      next.set(
        signup.id,
        role ? resolveDisplaySpecForSelectedRole(signupOfferedSpecInput(signup), role) : null,
      );
      return next;
    });
  }

  /** Reassign selected slot: role + optional chosen specialization (client display). */
  function assignRole(signup: SignupRow, role: CharacterRole, specialization: string | null = null) {
    if (!isConcreteCharacterRole(role)) return;
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    if (!signup.assignableRoles.includes(role)) return;
    if (!stagedSelections.has(signup.id)) return;
    setError(null);
    setErrorCode(null);
    setStagedSelections((previous) => {
      if (!previous.has(signup.id)) return previous;
      const next = new Map(previous);
      next.set(signup.id, role);
      return next;
    });
    setStagedSpecs((previous) => {
      const next = new Map(previous);
      next.set(
        signup.id,
        specialization ?? resolveDisplaySpecForSelectedRole(signupOfferedSpecInput(signup), role),
      );
      return next;
    });
  }

  /**
   * Click-to-draft with an explicit role (+ optional spec from the Choose-spec modal).
   * Spec is client-stage only; domain persists selectedRole.
   */
  function selectWithRole(
    signup: SignupRow,
    role: CharacterRole,
    specialization: string | null = null,
    replacesSignupId?: string,
  ) {
    if (!isConcreteCharacterRole(role)) return;
    if (!data.roster.canEdit || data.roster.needsPublishSeed || pending) return;
    if (!signup.assignableRoles.includes(role)) return;
    if (signup.status === "WITHDRAWN") return;
    if (!stagedSelections.has(signup.id) && (signup.scheduleConflicts?.length ?? 0) > 0) return;
    if (!stagedSelections.has(signup.id)) {
      const unconfirmed = warningsNeedingConfirmation(signup);
      if (unconfirmed.length > 0) {
        setWarningPrompt({
          kind: "pick",
          signup,
          pendingRole: role,
          pendingSpec: specialization,
          replacesSignupId,
          items: [{ key: signup.id, characterLabel: signupDisplayName(signup), warnings: unconfirmed }],
        });
        return;
      }
    }
    commitSelectWithRole(signup, role, specialization, replacesSignupId);
  }

  function commitSelectWithRole(
    signup: SignupRow,
    role: CharacterRole,
    specialization: string | null = null,
    replacesSignupId?: string,
  ) {
    setError(null);
    setErrorCode(null);
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
    setStagedSelections((previous) => {
      const next = new Map(previous);
      for (const otherId of replaceBoosterSignupIds) {
        if (otherId !== signup.id) next.delete(otherId);
      }
      if (replacesSignupId) next.delete(replacesSignupId);
      next.set(signup.id, role);
      return next;
    });
    setStagedSpecs((previous) => {
      const next = new Map(previous);
      for (const otherId of replaceBoosterSignupIds) {
        if (otherId !== signup.id) next.delete(otherId);
      }
      if (replacesSignupId) next.delete(replacesSignupId);
      next.set(
        signup.id,
        specialization ?? resolveDisplaySpecForSelectedRole(signupOfferedSpecInput(signup), role),
      );
      return next;
    });
  }

  function discardChanges() {
    setError(null);
    setErrorCode(null);
    setStagedSelections(new Map(savedSelections));
    setStagedSpecs(collectInitialStagedSpecs(data, savedSelections));
    setStagedBossExceptions([...data.bossPlan.draft]);
  }

  /** Acknowledgements for the currently staged slots only — a deselected pick's confirmation is not sent. */
  function stagedConfirmedWarnings(confirmed: Map<string, ConfirmedRosterWarning[]>): ConfirmedRosterWarning[] {
    return [...stagedSelections.keys()].flatMap((signupId) => confirmed.get(signupId) ?? []);
  }

  /** Adds the given acknowledgements (replacing older ones of the same signup + type) and returns the new map. */
  function withConfirmedWarnings(additions: ConfirmedRosterWarning[]): Map<string, ConfirmedRosterWarning[]> {
    const next = new Map(confirmedWarnings);
    for (const addition of additions) {
      const kept = (next.get(addition.signupId) ?? []).filter((row) => row.type !== addition.type);
      next.set(addition.signupId, [...kept, addition]);
    }
    setConfirmedWarnings(next);
    return next;
  }

  /**
   * The server recomputes warnings before accepting new picks. When it still
   * needs a confirmation (lockout changed since this page loaded, or the pick
   * was staged another way), show its CURRENT warnings instead of an error.
   */
  function handleRosterWriteFailure(
    action: "save" | "update",
    result: { code: string; message: string; pendingWarnings?: PendingRosterSelectionWarning[] },
  ) {
    if (result.code === "ROSTER_WARNING_CONFIRMATION_REQUIRED" && result.pendingWarnings?.length) {
      setWarningPrompt({ kind: "server", action, pending: result.pendingWarnings });
      return;
    }
    // Also an alternate Character of the boss plan: say so, Refresh drops it.
    setError(
      result.code === "SIGNUP_WITHDRAWN"
        ? `${result.message} A Character on this roster or in its boss plan withdrew — refresh to load the current signups.`
        : result.message,
    );
    setErrorCode(result.code);
  }

  function saveRoster(confirmed: Map<string, ConfirmedRosterWarning[]> = confirmedWarnings) {
    if (!isDirty || pending) return;
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await saveRosterDraftAction({
        runId: data.run.id,
        version: data.roster.version,
        selections: [...stagedSelections].map(([signupId, selectedRole]) => ({ signupId, selectedRole })),
        confirmedWarnings: stagedConfirmedWarnings(confirmed),
        // Full DRAFT set; omitted while the feature is off (the saved ones stay).
        ...(bossPlanEditable ? { bossExceptions: bossPayload } : {}),
      });
      if (!result.ok) {
        handleRosterWriteFailure("save", result);
        return;
      }
      router.refresh();
    });
  }

  function cancelWarningPrompt() {
    // Cancel never mutates: a pending pick stays unselected, a rejected write stays unsent.
    setWarningPrompt(null);
  }

  function confirmWarningPrompt() {
    const prompt = warningPrompt;
    if (!prompt) return;
    setWarningPrompt(null);
    if (prompt.kind === "pick") {
      withConfirmedWarnings(
        prompt.items.flatMap((item) => confirmedWarningsFor(prompt.signup.id, item.warnings)),
      );
      if (prompt.pendingRole && isConcreteCharacterRole(prompt.pendingRole)) {
        commitSelectWithRole(prompt.signup, prompt.pendingRole, prompt.pendingSpec ?? null, prompt.replacesSignupId);
      } else {
        stageRoleCopy(prompt.signup, true);
      }
      return;
    }
    const confirmed = withConfirmedWarnings(
      prompt.pending.flatMap((row) => (row.signupId ? confirmedWarningsFor(row.signupId, [row.warning]) : [])),
    );
    if (prompt.action === "save") saveRoster(confirmed);
    else confirmDialog(confirmed);
  }

  /** Find replacement for a draft slot: same role by default, Run context comes from this editor. */
  function openReplacement(signup: SignupRow) {
    const current = stagedRole(signup.id);
    const role =
      current && isConcreteCharacterRole(current) ? current : (signup.assignableRoles[0] as ConcreteCharacterRole | undefined);
    if (!role) return;
    setReplacement({
      target: {
        signupId: signup.id,
        userId: signup.userId,
        label: signupDisplayName(signup),
        reasons: rosterReplacementReasons(signup).map((reason) => reason.label),
      },
      role,
    });
  }

  function openFillSlot(role: ConcreteCharacterRole, label: string, reasons: string[] = []) {
    setReplacement({ target: { signupId: null, userId: null, label, reasons }, role });
  }

  /** Stages the chosen candidate (replacing the slot) — same confirmation path as a tile click. */
  function chooseReplacement(candidate: ReplacementCandidate<SignupRow>) {
    const replaces = replacement?.target.signupId ?? undefined;
    setReplacement(null);
    selectWithRole(candidate.signup, candidate.role, null, replaces);
  }

  /** Fill gaps / Build: the proposal replaces the staged draft; the Raid Lead reviews, then Saves / Updates. */
  function stageProposal(input: {
    selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
    confirmed: ConfirmedRosterWarning[];
  }) {
    setError(null);
    setErrorCode(null);
    if (input.confirmed.length > 0) withConfirmedWarnings(input.confirmed);
    const next: StagedSelections = new Map(input.selections.map((row) => [row.signupId, row.selectedRole]));
    // A pick that keeps its role keeps the spec the Raid Lead chose; new picks get the default display spec.
    const defaults = collectInitialStagedSpecs(data, next);
    const specs: StagedSpecs = new Map(
      [...defaults].map(([signupId, spec]) => [
        signupId,
        stagedSelections.get(signupId) === next.get(signupId) && stagedSpecs.has(signupId)
          ? (stagedSpecs.get(signupId) ?? null)
          : spec,
      ]),
    );
    setStagedSelections(next);
    setStagedSpecs(specs);
  }

  function syncSelectedCharacters() {
    setError(null);
    setErrorCode(null);
    setNotice(null);
    startTransition(async () => {
      const result = await syncRosterCharactersAction({ runId: data.run.id });
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setNotice(result.message);
      router.refresh();
    });
  }

  /** Late Fill: one explicit request — the server pings the missing roles' Guild roles (cooldown per role). */
  function requestLateFillHelp() {
    setError(null);
    setErrorCode(null);
    setNotice(null);
    startTransition(async () => {
      const result = await requestLateFillHelpAction({ runId: data.run.id });
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setNotice(result.message);
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

  function openDialog(mode: "publish" | "update" | "repost") {
    setDialogMode(mode);
    setAcknowledge(false);
    dialogRef.current?.showModal();
  }

  /**
   * Publish (first) accepts the saved draft and syncs the persistent Roster
   * message; Update accepts the CURRENT selection in one step and edits the
   * same message; repost asks the bot to refresh that same Roster message.
   */
  function confirmDialog(confirmed: Map<string, ConfirmedRosterWarning[]> = confirmedWarnings) {
    setError(null);
    setErrorCode(null);
    const acknowledgeWarnings = acknowledge || liveValidation.warnings.length === 0;
    startTransition(async () => {
      const result =
        dialogMode === "update"
          ? await updateRosterAction({
              runId: data.run.id,
              version: data.roster.version,
              selections: [...stagedSelections].map(([signupId, selectedRole]) => ({ signupId, selectedRole })),
              acknowledgeWarnings,
              confirmedWarnings: stagedConfirmedWarnings(confirmed),
              ...(bossPlanEditable ? { bossExceptions: bossPayload } : {}),
            })
          : dialogMode === "repost"
            ? await repostRosterAction({
                runId: data.run.id,
                version: data.roster.version,
                postRevision: data.roster.postRevision,
              })
            : await publishRosterAction({ runId: data.run.id, version: data.roster.version, acknowledgeWarnings });
      if (!result.ok) {
        handleRosterWriteFailure("update", result);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  const editing = data.roster.canEdit && !data.roster.needsPublishSeed;
  const togglesLocked = pending;
  const isPublished = Boolean(data.roster.publishedAt);
  // Published: local or saved changes (or changed Run settings) need Update
  // Roster — one action; a clean published roster offers Publish Roster as a
  // deliberate Discord repost. Never published: Save, then Publish.
  const actions = resolveRosterActions({
    canEdit: data.roster.canEdit,
    runStatus: data.run.status,
    isPublished,
    hasLocalEdits: isDirty,
    hasUnpublishedChanges: data.roster.hasUnpublishedChanges,
    needsPublishSeed: data.roster.needsPublishSeed,
  });
  const canRepost = actions.repost;

  const validationIssueCount = liveValidation.blockers.length + liveValidation.warnings.length;

  // —— Needs attention: existing warnings, each with its direct action ——
  const missing = {
    tanks: Math.max(0, -liveComposition.tanks.delta),
    healers: Math.max(0, -liveComposition.healers.delta),
    dps: Math.max(0, -liveComposition.dps.delta),
    lootbuddies: Math.max(0, -liveComposition.lootbuddies.delta),
  };
  const missingTotal = missing.tanks + missing.healers + missing.dps + missing.lootbuddies;
  const attentionSlots = editing
    ? domainSignups
        .filter((signup) => stagedSelections.has(signup.id))
        .map((signup) => ({ signup, reasons: rosterReplacementReasons(signup) }))
        .filter((row) => row.reasons.length > 0)
    : [];
  const openWithdrawals = editing
    ? data.withdrawnPicks
        .map((pick) => ({ pick, role: withdrawnPickOpenRole(pick.assignableRoles, missing) }))
        .filter((row): row is { pick: (typeof data.withdrawnPicks)[number]; role: ConcreteCharacterRole } => row.role != null)
    : [];
  // Same set the server syncs: saved draft / published picks without a fresh Blizzard sync.
  const staleSelected = editing
    ? domainSignups.filter(
        (signup) =>
          signup.participationType === "BOOSTER" &&
          signup.characterActive &&
          (signup.draftSelected || signup.status === "SELECTED") &&
          signup.syncHealth != null &&
          signup.syncHealth !== "HEALTHY",
      )
    : [];
  const dpsFillRole: ConcreteCharacterRole = roleBreakdown.meleeDps <= roleBreakdown.rangedDps ? "MELEE_DPS" : "RANGED_DPS";
  const showAttention =
    editing && (missingTotal > 0 || attentionSlots.length > 0 || openWithdrawals.length > 0 || staleSelected.length > 0);

  const rosterDiff = useMemo(() => {
    if (!data.roster.publishedAt) return [];
    const member = (signup: SignupRow, role: CharacterRole | null): RosterDiffMember => ({
      signupId: signup.id,
      userId: signup.userId,
      participationType: signup.participationType,
      role: signup.participationType === "LOOTBUDDY" ? null : role,
      label: signupDisplayName(signup),
    });
    const publishedSignups = domainSignups.filter((signup) => signup.status === "SELECTED");
    const draftMembers = domainSignups
      .filter((signup) => stagedSelections.has(signup.id))
      .map((signup) => member(signup, stagedSelections.get(signup.id) ?? null));
    const changes = diffRoster(
      publishedSignups.map((signup) => member(signup, signup.publishedRole)),
      draftMembers,
    );
    if (!bossPlanEditable) return changes;
    return [
      ...changes,
      ...diffBossPlans({
        published: data.bossPlan.published,
        draft: bossPayload,
        members: new Map(draftMembers.map((row) => [row.signupId, row])),
        publishedSlotIds: new Set(publishedSignups.map((signup) => signup.id)),
        bosses: data.bossPlan.bosses,
        characterLabelBySignupId,
      }),
    ];
  }, [
    data.roster.publishedAt,
    domainSignups,
    stagedSelections,
    bossPlanEditable,
    data.bossPlan.published,
    data.bossPlan.bosses,
    bossPayload,
    characterLabelBySignupId,
  ]);

  function renderSignupTile(signup: SignupRow) {
    return (
      <li key={signup.id}>
        <SignupTile
          signup={signup}
          difficulty={data.run.difficulty}
          editing={editing}
          locked={togglesLocked}
          selected={isStagedSelected(signup.id)}
          assignedRole={stagedRole(signup.id)}
          assignedSpec={stagedSpecs.get(signup.id) ?? null}
          onToggle={toggleRoleCopy}
          onSelectWithRole={selectWithRole}
          onChangeRole={assignRole}
          onDeselect={() => deselectSignup(signup)}
        />
      </li>
    );
  }

  function renderExternalTile(booster: (typeof externalBoosters)[number]) {
    return (
      <li key={`ext-${booster.id}`}>
        <div
          className="flex h-full items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 text-sm"
          title="External · edit via Add Booster"
        >
          <ClassIcon wowClass={booster.wowClass} size={24} />
          <span className="min-w-0 truncate text-sm font-semibold" style={{ color: CLASS_COLORS[booster.wowClass] }}>
            @{booster.name}
          </span>
          <span className="ml-auto shrink-0 text-xs text-accent">EXT</span>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-danger">
          <p>{error}</p>
          {errorCode === "ROSTER_ALREADY_CHANGED" || errorCode === "SIGNUP_WITHDRAWN" ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => router.refresh()}>
              Refresh roster
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
      {embedded ? null : (
      <Card>
        <CardHeader
          title={
            <Link href={runDetailPath(data.run.id)} className="hover:underline underline-offset-2">
              {data.run.title}
            </Link>
          }
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
        <div className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Signups" value={`${data.run.activeSignupCount} active`} />
          <Stat label="Published selected" value={String(data.run.publishedSelectedCount)} />
          <Stat label="Backups" value={String(data.run.backupCount)} />
          <Stat
            label="Signup window"
            value={data.run.signupWindowOpen ? "Open" : "Closed"}
          />
        </div>
        {data.roster.publishedAt ? (
          <p className="border-t border-border px-3 py-2 text-sm text-muted">
            Published by {data.roster.publishedByName ?? "Unknown"} · {formatDateTime(data.roster.publishedAt)}
          </p>
        ) : null}
      </Card>
      )}

      {afterContext}

      {/* —— ROSTER: status, checks and every roster action first; then the 4-group grid —— */}
      <section id={ROSTER_ATTENTION_ANCHOR} className="scroll-mt-20 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-base font-semibold text-foreground">
              Roster{" "}
              <span className="font-normal tabular-nums text-muted">
                {draftSlotCount}/{rosterCapacity}
              </span>
              {isDirty ? (
                <span className="ml-2 text-sm font-normal text-warning">Unsaved</span>
              ) : null}
              {data.roster.canEdit && data.roster.hasUnpublishedChanges && !isDirty ? (
                <span className="ml-2 text-sm font-normal text-warning">Unpublished</span>
              ) : null}
            </h3>
            {embedded ? (
              <RosterContextChips
                runId={data.run.id}
                validationIssueCount={validationIssueCount}
                preflightAttentionCount={preflightAttentionCount}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.roster.canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending || isDirty}
                title={isDirty ? "Save or discard your roster changes first" : undefined}
                onClick={() => openAddBooster("registered")}
              >
                Add Booster
                {externalBoosters.length > 0 ? (
                  <span className="tabular-nums text-muted">· {externalBoosters.length} ext</span>
                ) : null}
              </Button>
            ) : null}
            {data.roster.canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!editing || pending}
                onClick={() => setBuilderMode(stagedSelections.size > 0 ? "fill" : "build")}
              >
                Auto Build Roster
              </Button>
            ) : null}
            {bossPlanEditable && editing ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-expanded={bossPlanOpen}
                aria-controls="roster-boss-plan"
                onClick={() => setBossPlanOpen((open) => !open)}
              >
                Boss plan
                {bossPayload.length > 0 ? (
                  <span className="tabular-nums text-accent">
                    {new Set(bossPayload.map((row) => row.slotSignupId)).size}
                  </span>
                ) : null}
              </Button>
            ) : null}
            {actions.seed ? (
              <Button type="button" size="md" disabled={pending} onClick={seedPublished}>
                {pending ? "Loading…" : "Edit Published"}
              </Button>
            ) : null}
            {actions.save ? (
              <Button type="button" size="md" disabled={pending || !editing} onClick={() => saveRoster()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            ) : null}
            {actions.update ? (
              <Button
                type="button"
                size="md"
                disabled={pending || !data.roster.canEdit || !liveValidation.canPublish}
                onClick={() => openDialog("update")}
              >
                Update
              </Button>
            ) : null}
            {actions.publish ? (
              <Button
                type="button"
                size="md"
                disabled={pending || !data.roster.canEdit || !liveValidation.canPublish}
                onClick={() => openDialog("publish")}
              >
                Publish
              </Button>
            ) : null}
            {canRepost ? (
              <Button
                type="button"
                size="md"
                variant="secondary"
                disabled={pending || !data.roster.canEdit}
                onClick={() => openDialog("repost")}
              >
                Publish
              </Button>
            ) : null}
            {actions.discard ? (
              <Button type="button" size="md" variant="ghost" disabled={pending} onClick={discardChanges}>
                Discard
              </Button>
            ) : null}
          </div>
        </div>

        {showAttention ? (
          <div
            className={`space-y-1.5 rounded-md border px-3 py-2 text-sm ${
              data.run.lateFill && missingTotal > 0 ? "border-warning/45 bg-warning/5" : "border-border bg-surface-raised/30"
            }`}
          >
            {missingTotal > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className={`font-medium ${data.run.lateFill ? "text-warning" : "text-foreground"}`}>
                  {data.run.lateFill
                    ? `Late fill · Need ${missingTotal} ${missingTotal === 1 ? "replacement" : "replacements"}`
                    : "Still needed"}
                </span>
                {(
                  [
                    ["TANK", "Tank", missing.tanks],
                    ["HEALER", "Healer", missing.healers],
                    [dpsFillRole, "DPS", missing.dps],
                  ] as const
                )
                  .filter(([, , count]) => count > 0)
                  .map(([role, label, count]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={pending}
                      onClick={() => openFillSlot(role, `${label} slot`)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:border-accent/60 hover:text-foreground disabled:opacity-50"
                    >
                      <RoleIcon role={role} size={14} />
                      {label} ×{count}
                    </button>
                  ))}
                {missing.lootbuddies > 0 ? (
                  <span className="text-xs text-muted">Lootbuddy ×{missing.lootbuddies}</span>
                ) : null}
                {missing.tanks + missing.healers + missing.dps > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={requestLateFillHelp}
                    title="Ping the Guild Tank / Healer / DPS role in the Run channel for the saved roster's open slots"
                  >
                    Ping missing roles
                  </Button>
                ) : null}
              </div>
            ) : null}
            {attentionSlots.map(({ signup, reasons }) => (
              <div key={signup.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <WarningIcon label={reasons.map((reason) => reason.label).join("\n")} size={14} />
                <span className="font-medium">{signupDisplayName(signup)}</span>
                <span className="min-w-0 text-xs text-muted">{reasons.map((reason) => reason.label).join(" · ")}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => openReplacement(signup)}
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  <ReplaceIcon size={14} />
                  Find replacement
                </button>
              </div>
            ))}
            {openWithdrawals.map(({ pick, role }) => (
              <div key={pick.signupId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <WarningIcon label="Withdrew" size={14} />
                <span className="font-medium">{pick.characterLabel}</span>
                <span className="min-w-0 text-xs text-muted">withdrew · {pick.reason}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    openFillSlot(role, `${pick.characterLabel}'s slot`, [`${pick.characterLabel} withdrew: ${pick.reason}`])
                  }
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  <ReplaceIcon size={14} />
                  Find replacement
                </button>
              </div>
            ))}
            {staleSelected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <WarningIcon label="Blizzard sync" size={14} />
                <span className="min-w-0 text-xs text-muted">
                  {staleSelected.length} selected Character{staleSelected.length === 1 ? "" : "s"} without a fresh
                  Blizzard sync — lockouts may be outdated
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={syncSelectedCharacters}
                  className="ml-auto inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  {pending ? "Syncing…" : "Sync Characters"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {draftGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Group {groupIndex + 1}
              </p>
              <ul className="space-y-1">
                {group.map((slot, slotIndex) => (
                  <li key={`${groupIndex}-${slotIndex}`} className="flex gap-1">
                    {slot ? (
                      <>
                      <button
                        type="button"
                        disabled={!editing || togglesLocked || (!slot.signup && isDirty)}
                        onClick={() => {
                          if (slot.signup) deselectSignup(slot.signup);
                          else openAddBooster("external");
                        }}
                        title={slot.external ? "External — click to edit External Boosters" : "Remove from draft"}
                        className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-md border border-border/80 bg-surface-raised/40 px-2.5 py-2 text-left text-sm hover:border-danger/50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {slot.wowClass ? <ClassIcon wowClass={slot.wowClass} size={22} /> : null}
                        {slot.bossPlan ? (
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span
                              className="truncate text-[13px] font-semibold"
                              style={slot.wowClass ? { color: CLASS_COLORS[slot.wowClass] } : undefined}
                            >
                              {slot.name}
                            </span>
                            <span className="truncate text-xs text-accent" title={slot.bossPlan}>
                              {slot.bossPlan}
                            </span>
                          </span>
                        ) : (
                          <span
                            className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                            style={slot.wowClass ? { color: CLASS_COLORS[slot.wowClass] } : undefined}
                          >
                            {slot.name}
                          </span>
                        )}
                        {slot.wowClass && slot.specialization ? (
                          // A replaceable slot also carries the Replace button: keep the name readable on phones.
                          <span className={editing && slot.replaceable ? "hidden sm:inline-flex" : "inline-flex"}>
                            <SpecIcon wowClass={slot.wowClass} specialization={slot.specialization} size={18} />
                          </span>
                        ) : null}
                        {slot.role && isConcreteScanRole(slot.role) ? <RoleIcon role={slot.role} size={18} /> : null}
                        {slot.warningReasons.length > 0 ? (
                          <WarningIcon label={slot.warningReasons.join("\n")} size={16} />
                        ) : null}
                      </button>
                      {editing && slot.replaceable && slot.signup ? (
                        <button
                          type="button"
                          disabled={togglesLocked}
                          onClick={() => openReplacement(slot.signup!)}
                          title={`Find replacement for ${slot.name}`}
                          aria-label={`Find replacement for ${slot.name}`}
                          className="inline-flex min-h-[40px] w-7 shrink-0 items-center justify-center rounded-md border border-border/80 text-accent hover:border-accent/60 hover:bg-accent/10 disabled:opacity-50"
                        >
                          <ReplaceIcon size={15} />
                        </button>
                      ) : null}
                      </>
                    ) : (
                      <div className="flex min-h-[40px] w-full items-center rounded-md border border-dashed border-border/50 px-2.5 py-2 text-sm text-muted/70">
                        Empty
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {bossPlanEditable && editing && bossPlanOpen ? (
          <div id="roster-boss-plan">
            <RosterBossPlanPanel
              bosses={data.bossPlan.bosses}
              exceptions={bossPayload}
              slots={draftSlots
                .filter((slot) => slot.signup?.participationType === "BOOSTER")
                .map((slot) => ({ signup: slot.signup!, name: slot.name, wowClass: slot.wowClass, role: slot.role }))}
              signups={data.boosters}
              stagedSlotIds={new Set(stagedSelections.keys())}
              evaluation={bossEvaluation}
              editing={!togglesLocked}
              onChange={(next) => {
                setError(null);
                setErrorCode(null);
                setStagedBossExceptions(next);
              }}
            />
          </div>
        ) : bossEvaluation.issues.length > 0 || bossEvaluation.warnings.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <WarningIcon label="Boss plan" size={14} />
            <span className={bossEvaluation.issues.length > 0 ? "text-danger" : "text-warning"}>
              {(bossEvaluation.issues[0] ?? bossEvaluation.warnings[0])!.message}
              {bossEvaluation.issues.length + bossEvaluation.warnings.length > 1
                ? ` (+${bossEvaluation.issues.length + bossEvaluation.warnings.length - 1} more)`
                : ""}
            </span>
            {bossPlanEditable && editing ? (
              <button
                type="button"
                onClick={() => setBossPlanOpen(true)}
                className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-accent hover:bg-accent/10"
              >
                Review boss plan
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <CompositionMeter label="T" slot={liveComposition.tanks} compact />
          <CompositionMeter label="H" slot={liveComposition.healers} compact />
          <CompositionMeter label="D" slot={liveComposition.dps} compact />
          <CompositionMeter label="LB" slot={liveComposition.lootbuddies} compact />
          {roleBreakdown.legacyDps > 0 ? <span>Unassigned DPS {roleBreakdown.legacyDps}</span> : null}
        </div>

        {data.roster.canEdit && data.roster.runChangedSinceAck ? (
          <p className="text-sm text-warning">
            Run details changed since last publish — Update before starting.
          </p>
        ) : null}
      </section>

      {/* —— SIGNUPS: readable tile grid (4–5 / row at 1440) —— */}
      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-foreground">
            Signups <span className="font-normal tabular-nums text-muted">{gridSignups.length}</span>
            {editing ? <span className="ml-2 text-sm font-normal text-muted">Click a tile to add or remove it</span> : null}
          </h3>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            Group by
            <select
              value={groupBy}
              onChange={(event) => {
                const mode = SIGNUP_GROUP_BY_MODES.find((value) => value === event.target.value);
                if (mode) setSignupGroupBy(mode);
              }}
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
            >
              {SIGNUP_GROUP_BY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SIGNUP_GROUP_BY_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <CompactRosterFilters
          search={search}
          setSearch={setSearch}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          selectedFilter={selectedFilter}
          setSelectedFilter={setSelectedFilter}
          participation={participation}
          setParticipation={setParticipation}
          backupFilter={backupFilter}
          setBackupFilter={setBackupFilter}
          perfFilter={perfFilter}
          setPerfFilter={setPerfFilter}
          perfSort={perfSort}
          setPerfSort={setPerfSort}
        />

        {gridSignups.length === 0 && externalBoosters.length === 0 ? (
          <p className="py-3 text-sm text-muted">No signups match these filters.</p>
        ) : groupBy === "NONE" ? (
          <ul className={SIGNUP_GRID_CLASS}>
            {externalBoosters.map(renderExternalTile)}
            {gridSignups.map(renderSignupTile)}
          </ul>
        ) : (
          // Same tiles and actions, laid out per player / role (presentation only).
          <div className="space-y-2.5">
            {buildSignupGroups({ mode: groupBy, tiles: gridSignups, externals: externalBoosters, roleFilter }).map(
              (group) => (
                <section key={group.key} aria-label={group.label ?? undefined}>
                  <h4 className="mb-1 flex items-baseline gap-1.5 text-xs font-semibold text-foreground">
                    <span className="truncate">{group.label}</span>
                    <span className="shrink-0 font-normal tabular-nums text-muted">
                      · {signupGroupCountLabel(group.tiles.length + group.externals.length)}
                    </span>
                  </h4>
                  <ul className={SIGNUP_GRID_CLASS}>
                    {group.externals.map(renderExternalTile)}
                    {group.tiles.map(renderSignupTile)}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </section>

      {/* —— BUFFS: compact strip, the Roster tab's last section —— */}
      <ClassBuffChecker coverage={liveRaidBuffCoverage} />

      <dialog
        ref={dialogRef}
        aria-labelledby="publish-title"
        className="fixed left-1/2 top-[8vh] m-0 w-[min(32rem,calc(100vw-2rem))] max-h-[min(84vh,40rem)] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="publish-title" className="text-base font-semibold" tabIndex={-1}>
            {dialogMode === "update"
              ? `Update Roster${rosterDiff.length > 0 ? ` · ${rosterDiff.length} change${rosterDiff.length === 1 ? "" : "s"}` : ""}`
              : dialogMode === "repost"
                ? "Post the roster again"
                : "Publish roster"}
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm">
          {dialogMode === "update" ? (
            <>
              <RosterUpdateDiff changes={rosterDiff} runChanged={data.roster.runChangedSinceAck} />
              <p className="text-muted">
                Accepts this selection as the published roster and edits the current Discord roster post in place.
                Players are notified about their own changes only. The run stays PUBLISHED and editable until Start.
              </p>
            </>
          ) : dialogMode === "repost" ? (
            <p>
              Refreshes the current Discord Roster message in place (same message id). No second Roster post is
              created. Players are not notified again.
            </p>
          ) : (
            <p>
              Publishing will mark draft-selected signups as SELECTED, mark remaining active candidates as
              NOT_SELECTED, lock self-withdrawal for selected players on a published run, and set the run to
              PUBLISHED. The roster stays editable until the run starts.
            </p>
          )}
          <p>
            {liveComposition.tanks.selected} Tanks · {liveComposition.healers.selected} Healers ·{" "}
            {liveComposition.dps.selected} DPS
            {roleBreakdown.legacyDps > 0 ? ` (${roleBreakdown.legacyDps} unassigned)` : ""} ·{" "}
            {liveComposition.lootbuddies.selected} Lootbuddies
          </p>
          <p>
            {liveComposition.boosterTotal} Boosters · {liveComposition.lootbuddies.selected} Lootbuddies ·{" "}
            {liveComposition.total} total selected
          </p>
          {dialogMode !== "repost" && liveValidation.warnings.length > 0 ? (
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
              (dialogMode === "publish" && isDirty) ||
              (dialogMode !== "repost" &&
                (!liveValidation.canPublish || (liveValidation.warnings.length > 0 && !acknowledge)))
            }
            onClick={() => confirmDialog()}
          >
            {pending
              ? "Working…"
              : dialogMode === "update"
                ? "Confirm update"
                : dialogMode === "repost"
                  ? "Post again"
                  : "Confirm publish"}
          </Button>
        </div>
      </dialog>
      {warningPrompt ? (
        <RosterWarningConfirmDialog
          title={
            warningPrompt.kind === "pick" || warningPrompt.pending.length === 1
              ? "Pick saved Character?"
              : `${warningDialogItemsFromPending(warningPrompt.pending).length} roster selections need confirmation`
          }
          intro={
            warningPrompt.kind === "pick"
              ? `${warningPrompt.items[0]!.characterLabel} already has lockout progress for this Run.`
              : warningPrompt.pending.length === 1
                ? `${warningPrompt.pending[0]!.characterLabel} already has lockout progress for this Run.`
                : "These Characters already have lockout progress for this Run."
          }
          items={
            warningPrompt.kind === "pick"
              ? warningPrompt.items
              : warningDialogItemsFromPending(warningPrompt.pending)
          }
          confirmLabel="Select anyway"
          pending={pending}
          onCancel={cancelWarningPrompt}
          onConfirm={confirmWarningPrompt}
        />
      ) : null}
      {replacement ? (
        <RosterReplacementDialog
          target={replacement.target}
          initialRole={replacement.role}
          signups={data.boosters}
          staged={stagedSelections}
          difficulty={data.run.difficulty}
          onChoose={chooseReplacement}
          onClose={() => setReplacement(null)}
        />
      ) : null}
      {builderMode ? (
        <RosterBuilderDialog
          runId={data.run.id}
          initialMode={builderMode}
          draft={[...stagedSelections].map(([signupId, selectedRole]) => ({ signupId, selectedRole }))}
          onStage={stageProposal}
          onClose={() => setBuilderMode(null)}
        />
      ) : null}
      {addBoosterMode ? (
        <AddBoosterEntryDialog
          runId={data.run.id}
          rosterVersion={data.roster.version}
          externalBoosters={externalBoosters}
          initialMode={addBoosterMode}
          onClose={() => setAddBoosterMode(null)}
          onAdded={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function CompactRosterFilters({
  search,
  setSearch,
  roleFilter,
  setRoleFilter,
  selectedFilter,
  setSelectedFilter,
  participation,
  setParticipation,
  backupFilter,
  setBackupFilter,
  perfFilter,
  setPerfFilter,
  perfSort,
  setPerfSort,
}: {
  search: string;
  setSearch: (value: string) => void;
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  selectedFilter: string;
  setSelectedFilter: (value: string) => void;
  participation: string;
  setParticipation: (value: string) => void;
  backupFilter: string;
  setBackupFilter: (value: string) => void;
  perfFilter: WclPerfFilter;
  setPerfFilter: (value: WclPerfFilter) => void;
  perfSort: WclPerfSort;
  setPerfSort: (value: WclPerfSort) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[10rem] flex-1 text-sm sm:max-w-[16rem]">
        <span className="mb-1 block text-xs text-muted">Search</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm"
          placeholder="Player or character"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Role</span>
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="ALL">All</option>
          <option value="TANK">Tank</option>
          <option value="HEALER">Healer</option>
          <option value="DPS">DPS</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Draft</span>
        <select
          value={selectedFilter}
          onChange={(event) => setSelectedFilter(event.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="ALL">All</option>
          <option value="SELECTED">In draft</option>
          <option value="UNSELECTED">Available</option>
        </select>
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer list-none py-2 text-sm text-muted hover:text-foreground">
          More filters
        </summary>
        <div className="mt-1 flex flex-wrap gap-2 rounded border border-border/70 bg-surface-raised/30 p-2">
          <FilterSelect
            label="Participation"
            value={participation}
            onChange={setParticipation}
            options={["ALL", "BOOSTER", "LOOTBUDDY"]}
          />
          <FilterSelect
            label="Offer"
            value={backupFilter}
            onChange={setBackupFilter}
            options={["ALL", "PRIMARY", "BACKUP"]}
          />
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
      </details>
    </div>
  );
}

function isConcreteScanRole(role: CharacterRole): role is Exclude<CharacterRole, "DPS"> {
  return role === "TANK" || role === "HEALER" || role === "MELEE_DPS" || role === "RANGED_DPS";
}

/**
 * Role shown on the tile / roster.
 * Drafted: only the selected role. Undrafted single-offer: that role.
 * Undrafted multi-offer: no presumed role (chooser decides).
 */
function tileScanRole(signup: SignupRow, assignedRole: CharacterRole | null): CharacterRole | null {
  if (signup.participationType === "LOOTBUDDY") return null;
  if (assignedRole && isConcreteScanRole(assignedRole)) return assignedRole;
  const concrete = signup.assignableRoles.filter(isConcreteScanRole);
  if (concrete.length === 1) return concrete[0];
  return null;
}

function SignupTile({
  signup,
  difficulty,
  editing,
  locked,
  selected,
  assignedRole,
  assignedSpec,
  onToggle,
  onSelectWithRole,
  onChangeRole,
  onDeselect,
}: {
  signup: SignupRow;
  difficulty: RaidDifficulty;
  editing: boolean;
  locked: boolean;
  selected: boolean;
  assignedRole: CharacterRole | null;
  assignedSpec: string | null;
  onToggle: (signup: SignupRow, selected: boolean) => void;
  onSelectWithRole: (signup: SignupRow, role: CharacterRole, specialization?: string | null) => void;
  onChangeRole: (signup: SignupRow, role: CharacterRole, specialization?: string | null) => void;
  onDeselect: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const character = signup.character;
  const displayClass = lootbuddyDisplayClass(signup);
  const lockoutAttention = signup.contentSaves?.some((row) => row.label.attention) ?? false;
  const lockoutSaved =
    signup.contentSaves?.some((row) => row.label.kind === "saved" || row.label.kind === "fully_saved") ?? false;
  const scheduleConflicts = signup.scheduleConflicts ?? [];
  const scheduleBlocked = !selected && scheduleConflicts.length > 0;
  const runCommitments = signup.runCommitments ?? [];
  const plannedElsewhere = runCommitments.length > 0;
  // Warning icon: hard schedule conflict (<2h / weekly unavailable) OR already
  // RESERVED/COMMITTED on another Run in this raid ID week. Saved lockout tints the tile (no icon).
  const showScheduleOrCommitmentWarning = scheduleBlocked || plannedElsewhere;
  const commitmentWarningLabel = plannedElsewhere
    ? `Already planned: ${runCommitments
        .map((row) => row.runTitle || formatDateTime(row.scheduledStartAt))
        .join(" · ")}`
    : "";
  const scheduleOrCommitmentLabel = scheduleBlocked
    ? scheduleConflicts.map((row) => row.message).join(" · ") || "Schedule conflict"
    : commitmentWarningLabel;
  // The warning text is a hover tooltip on desktop; touch devices have no hover,
  // so the icon is also a button that toggles the text next to the tile.
  const tileWarningLabel = showScheduleOrCommitmentWarning
    ? scheduleOrCommitmentLabel
    : !selected && signup.issue
      ? signup.issue
      : null;
  const [warningOpen, setWarningOpen] = useState(false);
  const warningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!warningOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !warningRef.current?.contains(event.target as Node)) {
        setWarningOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [warningOpen]);
  const disabled = !editing || locked || signup.status === "WITHDRAWN" || scheduleBlocked;
  const offeredSpecs: OfferedSpecChoice[] =
    signup.participationType === "BOOSTER" ? resolveOfferedSpecs(signupOfferedSpecInput(signup)) : [];
  const needsSpecChoice = offeredSpecs.length > 1;
  const scanRole = tileScanRole(signup, assignedRole);
  const wclSegments: WclPerformanceRaidSegment[] = signup.wclPerformance ?? [];
  const displaySpecs = tileVisibleSpecs(offeredSpecs, selected, assignedSpec);
  const tileWcl = resolveSignupTileWclBest({
    segments: wclSegments,
    offeredSpecs,
    selected,
    assignedRole,
    assignedSpec,
  });
  const bestWcl = tileWcl.bestPct;
  const wclTooltip = tileWcl.tooltip;
  const characterLabel = character?.name ?? signupDisplayName(signup);
  const itemLevel = typeof character?.itemLevel === "number" ? character.itemLevel : null;

  function openSpecModal() {
    dialogRef.current?.showModal();
  }

  function closeSpecModal() {
    dialogRef.current?.close();
  }

  function activate() {
    if (disabled) return;
    if (selected) {
      onDeselect();
      return;
    }
    if (signup.participationType === "LOOTBUDDY") {
      onToggle(signup, true);
      return;
    }
    if (offeredSpecs.length === 1) {
      const only = offeredSpecs[0]!;
      onSelectWithRole(signup, only.role, only.name);
      return;
    }
    if (needsSpecChoice) {
      openSpecModal();
      return;
    }
    onToggle(signup, true);
  }

  function pickSpec(choice: OfferedSpecChoice) {
    closeSpecModal();
    if (selected) {
      onChangeRole(signup, choice.role, choice.name);
    } else {
      onSelectWithRole(signup, choice.role, choice.name);
    }
  }

  // Summed Bundle progress (e.g. HC 10/10) — no Unsaved/Fully saved suffixes.
  const lockoutShort = formatSignupTileLockoutShort(signup.contentSaves ?? [], difficulty);

  const canChangeSpec = selected && needsSpecChoice && !disabled;
  // Saved = verified boss kills on this Run's content (the HC X/10 line is shown).
  const tileTone = signupTileTone({ selected, warning: showScheduleOrCommitmentWarning, saved: lockoutSaved });

  return (
    <div ref={warningRef} className="relative h-full">
      {warningOpen && tileWarningLabel ? (
        // Outside the tile body (it clips with overflow-hidden), anchored under the tile.
        <div
          role="status"
          className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-warning/45 bg-surface px-2.5 py-2 text-xs leading-snug text-foreground shadow-lg"
        >
          {tileWarningLabel}
        </div>
      ) : null}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-pressed={selected}
        aria-label={characterLabel}
        onClick={() => {
          if (!disabled) activate();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        className={`flex h-full w-full flex-col justify-center gap-0.5 overflow-hidden rounded-md border px-2.5 py-1.5 text-left transition-colors ${
          disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"
        } ${SIGNUP_TILE_TONE_CLASSES[tileTone]} ${
          // Saved lockout: warning frame. `!` beats the unlayered `* { border-color }` in globals.css.
          lockoutSaved && !selected ? "border-warning/45!" : ""
        }`}
      >
        {/* Row 1 — identity: class · name · ilvl | role · check/warn */}
        <div className="flex h-6 items-center gap-1.5">
          {displayClass ? <ClassIcon wowClass={displayClass} size={24} /> : <span className="h-6 w-6 shrink-0" />}
          <span
            className="min-w-0 truncate text-sm font-semibold leading-none"
            style={displayClass ? { color: CLASS_COLORS[displayClass] } : undefined}
          >
            {characterLabel}
          </span>
          {itemLevel != null ? (
            <span className="shrink-0 tabular-nums text-[12px] font-normal leading-none text-muted">
              {itemLevel}
            </span>
          ) : null}
          <span className="min-w-0 flex-1" aria-hidden />
          {scanRole ? (
            canChangeSpec ? (
              <button
                type="button"
                title="Change spec"
                aria-label={`Change spec (${CHARACTER_ROLE_LABELS[scanRole]})`}
                className="inline-flex shrink-0 rounded-sm ring-offset-1 hover:ring-2 hover:ring-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  openSpecModal();
                }}
              >
                <RoleIcon role={scanRole} size={20} />
              </button>
            ) : (
              <RoleIcon role={scanRole} size={20} />
            )
          ) : needsSpecChoice && !selected ? (
            <span className="inline-block w-5 shrink-0" aria-hidden title="Multiple specs — click to choose" />
          ) : signup.participationType === "LOOTBUDDY" ? (
            <LootbuddyIcon size={20} />
          ) : null}
          {selected ? <DraftCheckIcon size={16} /> : null}
          {tileWarningLabel ? (
            <button
              type="button"
              aria-label={`Show warning: ${tileWarningLabel}`}
              aria-expanded={warningOpen}
              className="-m-1 inline-flex shrink-0 rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
              onClick={(event) => {
                // Reveal the text only — never toggles the tile's selection.
                event.stopPropagation();
                setWarningOpen((open) => !open);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <WarningIcon label={tileWarningLabel} size={16} />
            </button>
          ) : !selected ? (
            <span className="inline-block w-4 shrink-0" aria-hidden />
          ) : null}
        </div>
        {/* Row 2 — spec icons · Best WCL link · lockout (fixed height; missing data stays empty) */}
        <div className="flex h-5 items-center gap-x-2 overflow-hidden pl-8 text-[12px] leading-none text-foreground/75">
          <span className="inline-flex shrink-0 items-center gap-1">
            {character?.wowClass && displaySpecs.length > 0
              ? displaySpecs.map((spec) =>
                  canChangeSpec && assignedSpec === spec.name ? (
                    <button
                      key={spec.name}
                      type="button"
                      className="inline-flex rounded-sm ring-offset-1 hover:ring-2 hover:ring-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      title={`Change spec (${spec.name})`}
                      aria-label={`Change spec (${spec.name})`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openSpecModal();
                      }}
                    >
                      <SpecIcon wowClass={character.wowClass} specialization={spec.name} size={14} />
                    </button>
                  ) : (
                    <SpecIcon
                      key={spec.name}
                      wowClass={character.wowClass}
                      specialization={spec.name}
                      size={14}
                    />
                  ),
                )
              : null}
          </span>
          {typeof bestWcl === "number" ? (
            <WclBestLink
              bestPct={bestWcl}
              warcraftLogsId={character?.warcraftLogsId}
              tooltip={wclTooltip}
              accessibleName={`Open ${characterLabel}${tileWcl.specName ? ` ${tileWcl.specName}` : ""} on Warcraft Logs`}
            />
          ) : null}
          {lockoutShort ? (
            <span
              className={`inline-flex max-w-[7.5rem] shrink-0 items-center gap-1 truncate ${
                lockoutAttention || lockoutSaved ? "font-medium text-warning" : "text-foreground/70"
              }`}
              title={formatContentLockoutTooltip(signup.contentSaves ?? [])}
            >
              <span aria-hidden className="text-foreground/45">
                ·
              </span>
              <LockoutIcon
                attention={lockoutAttention}
                label={lockoutAttention ? "Saved / lockout attention" : "Lockout"}
                size={13}
              />
              {lockoutShort}
            </span>
          ) : null}
          {signup.isBackup ? (
            <span className="shrink-0 text-foreground/60" title="Backup offer">
              B
            </span>
          ) : null}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={`spec-pick-title-${signup.id}`}
        className="fixed left-1/2 top-[12vh] m-0 w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/55"
        onClose={() => undefined}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeSpecModal();
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id={`spec-pick-title-${signup.id}`} className="text-base font-semibold">
            Choose spec for {characterLabel}
          </h2>
          <p className="mt-0.5 text-sm text-muted">Playable specs offered for this signup</p>
        </div>
        <div className="flex flex-col gap-2 p-3" role="listbox" aria-label="Choose spec">
          {offeredSpecs.map((choice) => (
            <ChooseSpecOption
              key={choice.name}
              choice={choice}
              characterLabel={characterLabel}
              wowClass={character?.wowClass ?? null}
              warcraftLogsId={character?.warcraftLogsId}
              wclSegments={wclSegments}
              isCurrent={Boolean(selected && assignedSpec === choice.name)}
              onSelect={pickSpec}
            />
          ))}
        </div>
        <div className="border-t border-border px-3 py-2">
          <Button type="button" size="md" variant="ghost" className="w-full" onClick={closeSpecModal}>
            Cancel
          </Button>
        </div>
      </dialog>
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
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
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

/** Validation / Preflight status next to the roster actions they gate (details on Operations). */
function RosterContextChips({
  runId,
  validationIssueCount,
  preflightAttentionCount,
}: {
  runId: string;
  validationIssueCount: number;
  preflightAttentionCount: number;
}) {
  const chips = [
    { label: "Validation", count: validationIssueCount, anchor: "#operations-validation" },
    { label: "Preflight", count: preflightAttentionCount, anchor: "#operations-preflight" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={runDetailPath(runId, "operations") + chip.anchor}
          className={
            chip.count > 0
              ? "inline-flex h-7 items-center gap-1 rounded-md border border-warning/35 bg-warning/10 px-2 text-warning hover:bg-warning/15"
              : "inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-muted hover:text-foreground"
          }
        >
          {chip.count > 0 ? (
            <WarningIcon label={chip.label} size={13} />
          ) : (
            <QuietOkIcon label={`${chip.label} OK`} size={13} />
          )}
          {chip.count > 0 ? `${chip.label} · ${chip.count}` : chip.label}
        </Link>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function ClassBuffChecker({ coverage }: { coverage: RaidBuffCoverage }) {
  const byClass = summarizeRaidBuffCoverageByClass(coverage);
  return (
    <div className="border-t border-border pt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Buffs</span>
        <span className="text-sm text-muted">
          {byClass.coveredCount}/{byClass.totalCount}
          {byClass.missingCount > 0 ? ` · ${byClass.missingCount} missing` : " covered"}
        </span>
      </div>
      <ul className="flex flex-wrap items-center gap-1" aria-label="Class buff coverage">
        {byClass.classes.map((item) => {
          const classLabel = CLASS_LABELS[item.wowClass];
          const providerName = item.providers[0]?.characterName ?? item.providers[0]?.userName ?? null;
          return (
            <li
              key={item.wowClass}
              title={
                item.covered
                  ? `${classLabel}${providerName ? ` — ${providerName}` : ""}`
                  : `${classLabel} missing`
              }
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                item.covered ? "opacity-90" : "bg-danger/10 ring-1 ring-danger/30"
              }`}
            >
              <ClassIcon
                wowClass={item.wowClass}
                size={18}
                className={item.covered ? undefined : "opacity-70 grayscale"}
              />
              <span className="sr-only">{item.covered ? "Covered: " : "Missing: "}</span>
              {item.covered ? (
                <BuffCoveredIcon size={12} className="opacity-70" />
              ) : (
                <BuffMissingIcon size={12} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CompositionMeter({
  label,
  slot,
  compact = false,
}: {
  label: string;
  slot: { selected: number; target: number; delta: number };
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <span className="text-muted">{label}</span>
        <span
          className={
            slot.delta !== 0 ? "font-semibold tabular-nums text-warning" : "font-semibold tabular-nums"
          }
        >
          {slot.selected}/{slot.target}
        </span>
      </span>
    );
  }
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-medium tabular-nums">
        {slot.selected} / {slot.target}
      </p>
      {slot.delta > 0 ? <p className="text-xs text-warning">{slot.delta} over target</p> : null}
      {slot.delta < 0 ? <p className="text-xs text-warning">{Math.abs(slot.delta)} under target</p> : null}
    </div>
  );
}
