import { assertCanManageCharacterOperations, type AuthenticatedUser } from "@/auth/authorization";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import { classifySyncError, type CharacterSyncTrigger } from "@/lib/blizzard/sync-error";
import {
  deriveCharacterSyncStatus,
  resolveSyncHealthStaleMinutes,
  type CharacterLinkageState,
  type CharacterSyncHealth,
} from "@/lib/blizzard/sync-health";
import { mapWithConcurrency } from "@/lib/concurrency";
import { DomainError, isDomainError } from "@/lib/errors";
import {
  defaultRaidBossTotal,
  projectCurrentRaidLockoutSlots,
  type LockoutDisplayRow,
  type RaidLockoutSlot,
} from "@/lib/lockout-display";
import { CHARACTER_SYNC_ERROR_LABELS } from "@/lib/labels";
import { getCurrentLockoutRaids, raidContentDisplayName } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import type { CharacterSyncErrorCode, WowClass, WowRegion } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import {
  characterOperationsRepository,
  connectionKey,
  type OperationsCharacterRecord,
} from "@/repositories/character-operations.repository";
import { characterRepository } from "@/repositories/character.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { userRepository } from "@/repositories/user.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import {
  manualCooldownRemainingMs,
  syncLinkedCharacterProfile,
  verifiedConnectionId,
} from "@/services/character-blizzard-sync.service";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { SCHEDULED_CHARACTER_SYNC_LOCK_KEY } from "@/services/scheduled-character-sync.service";
import type { CharacterOperationsFilters } from "@/validators/character-operations";

/**
 * Admin Character Operations (/manage/characters). Every state shown here is
 * derived by the PR #120 domain (deriveCharacterSyncStatus + the shared stale
 * policy) — rows, filters, sorting and the summary all read the same derived
 * row, so they can never disagree. Every sync goes through the single
 * syncLinkedCharacterProfile (telemetry + per-Character lock); "force" only
 * skips the normal manual cooldown in this operations layer.
 */

/** Bulk "Force refresh all" guards. */
export const BULK_FORCE_REFRESH_CONCURRENCY = 4;
export const BULK_FORCE_REFRESH_WORK_BUDGET_MS = 120_000;
export const BULK_FORCE_REFRESH_COOLDOWN_MS = 10 * 60_000;
/** ActivityEvent type whose latest occurredAt is the durable bulk-cooldown marker (written under the job lock). */
export const BULK_FORCE_REFRESH_STARTED_EVENT = "CHARACTER_BULK_FORCE_REFRESH_STARTED";
export const BULK_FORCE_REFRESH_COMPLETED_EVENT = "CHARACTER_BULK_FORCE_REFRESH_COMPLETED";

/** Only retirement blocks a sync: unlinked / unconnected Characters sync PUBLIC. */
export type SyncIneligibleReason = "RETIRED";

export const SYNC_INELIGIBLE_COPY: Record<SyncIneligibleReason, string> = {
  RETIRED: "Retired characters are not synced.",
};

export type OperationsRow = {
  id: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string | null;
  itemLevel: number | null;
  isActive: boolean;
  owner: { id: string; name: string; discordUsername: string | null };
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncErrorCode: CharacterSyncErrorCode | null;
  /** Readable copy for lastSyncErrorCode — never the raw enum as primary UI. */
  lastSyncErrorLabel: string | null;
  syncFailureCount: number;
  retired: boolean;
  linkage: CharacterLinkageState;
  /** Every active Character (VERIFIED or PUBLIC sync); null only when retired. */
  health: CharacterSyncHealth | null;
  lockoutSlots: RaidLockoutSlot[];
  /** Null when admin sync is allowed; otherwise why not (drives disabled buttons + server refusal). */
  syncIneligibleReason: SyncIneligibleReason | null;
  /** Normal "Sync now" cooldown left (Force refresh ignores it). */
  cooldownRemainingMs: number;
};

export type OperationsSummary = {
  total: number;
  active: number;
  retired: number;
  /** Active Characters by operational state (retired never counted as problems). */
  healthy: number;
  stale: number;
  errors: number;
  neverSynced: number;
  linked: number;
  noConnection: number;
  notLinked: number;
};

function currentRaidDescriptors() {
  return getCurrentLockoutRaids().map((raid) => ({ id: raid.id, name: raidContentDisplayName(raid.id, raid.name) }));
}

function lockoutRows(record: OperationsCharacterRecord): LockoutDisplayRow[] {
  return record.currentLockouts.map((lockout) => ({
    raidId: lockout.raidId,
    difficulty: lockout.difficulty,
    bossesDefeated: lockout.bossesDefeated,
    bossTotal: defaultRaidBossTotal(lockout.raidId),
    isComplete: lockout.isComplete,
    verified: true,
  }));
}

export function syncIneligibleReason(input: { isActive: boolean }): SyncIneligibleReason | null {
  return input.isActive ? null : "RETIRED";
}

/** The one row derivation used by the table, filters, sorting and summary. */
export function deriveOperationsRow(
  record: OperationsCharacterRecord,
  context: { ownerHasRegionConnection: boolean; now: Date; staleMinutes: number },
): OperationsRow {
  const status = deriveCharacterSyncStatus(record, context);
  // Retired Characters show "Retired" — they are not scheduled, so no health.
  const health = status.retired ? null : status.health;
  return {
    id: record.id,
    name: record.name,
    realm: record.realm,
    region: record.region,
    wowClass: record.wowClass,
    specialization: record.specialization,
    itemLevel: record.itemLevel,
    isActive: record.isActive,
    owner: record.owner,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncAttemptAt: record.lastSyncAttemptAt,
    lastSyncErrorAt: record.lastSyncErrorAt,
    lastSyncErrorCode: record.lastSyncErrorCode,
    lastSyncErrorLabel: record.lastSyncErrorCode ? CHARACTER_SYNC_ERROR_LABELS[record.lastSyncErrorCode] : null,
    syncFailureCount: record.syncFailureCount,
    retired: status.retired,
    linkage: status.linkage,
    health,
    lockoutSlots: projectCurrentRaidLockoutSlots(lockoutRows(record), currentRaidDescriptors()),
    syncIneligibleReason: syncIneligibleReason({ isActive: record.isActive }),
    cooldownRemainingMs: manualCooldownRemainingMs(record, context.now.getTime()),
  };
}

export function summarizeOperationsRows(rows: OperationsRow[]): OperationsSummary {
  const active = rows.filter((row) => !row.retired);
  const count = (predicate: (row: OperationsRow) => boolean) => active.filter(predicate).length;
  return {
    total: rows.length,
    active: active.length,
    retired: rows.length - active.length,
    healthy: count((row) => row.health === "HEALTHY"),
    stale: count((row) => row.health === "STALE"),
    errors: count((row) => row.health === "ERROR"),
    neverSynced: count((row) => row.health === "NEVER_SYNCED"),
    linked: count((row) => row.linkage === "LINKED"),
    noConnection: count((row) => row.linkage === "NO_CONNECTION"),
    notLinked: count((row) => row.linkage === "NOT_LINKED"),
  };
}

function matchesText(value: string, query: string): boolean {
  return value.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US"));
}

/**
 * Deterministic, combinable filters. A health filter matches active
 * Characters only (retired ones have no health).
 */
export function filterOperationsRows(rows: OperationsRow[], filters: CharacterOperationsFilters): OperationsRow[] {
  const query = filters.query?.trim();
  const owner = filters.owner?.trim();
  return rows.filter((row) => {
    if (query && !matchesText(row.name, query) && !matchesText(row.realm, query)) return false;
    if (
      owner &&
      row.owner.id !== owner &&
      !matchesText(row.owner.name, owner) &&
      !(row.owner.discordUsername && matchesText(row.owner.discordUsername, owner))
    ) {
      return false;
    }
    if (filters.wowClass && row.wowClass !== filters.wowClass) return false;
    if (filters.region && row.region !== filters.region) return false;
    if (filters.status === "active" && row.retired) return false;
    if (filters.status === "retired" && !row.retired) return false;
    if (filters.linkage && row.linkage !== filters.linkage) return false;
    if (filters.health && row.health !== filters.health) return false;
    return true;
  });
}

/** Operations-oriented health order: problems first; retired (no health) last. */
const HEALTH_SORT_RANK: Record<string, number> = {
  ERROR: 0,
  STALE: 1,
  NEVER_SYNCED: 2,
  HEALTHY: 3,
  RETIRED: 4,
};

function healthSortKey(row: OperationsRow): number {
  if (row.retired || !row.health) return HEALTH_SORT_RANK.RETIRED!;
  return HEALTH_SORT_RANK[row.health]!;
}

const collator = new Intl.Collator("en-US", { sensitivity: "base" });

/** Stable sorts; ties always fall back to character name, then id. */
export function sortOperationsRows(rows: OperationsRow[], sort: CharacterOperationsFilters["sort"]): OperationsRow[] {
  const byName = (a: OperationsRow, b: OperationsRow) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  const compare: Record<CharacterOperationsFilters["sort"], (a: OperationsRow, b: OperationsRow) => number> = {
    character: byName,
    owner: (a, b) => collator.compare(a.owner.name, b.owner.name) || byName(a, b),
    // Most recent success first; never-synced grouped at the end.
    last_success: (a, b) => {
      if (!a.lastSyncedAt && !b.lastSyncedAt) return byName(a, b);
      if (!a.lastSyncedAt) return 1;
      if (!b.lastSyncedAt) return -1;
      return new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime() || byName(a, b);
    },
    health: (a, b) => healthSortKey(a) - healthSortKey(b) || byName(a, b),
  };
  return [...rows].sort(compare[sort]);
}

function characterLabel(character: { name: string; realm: string; region: WowRegion }): string {
  return `${character.name}-${character.realm} (${character.region})`;
}

export type AdminSyncOutcome =
  | { status: "SUCCEEDED"; lockoutSynced: boolean; label: string }
  | { status: "FAILED"; errorCategory: CharacterSyncErrorCode; errorLabel: string; label: string };

export type BulkSkipReason = "ALREADY_SYNCING" | "RATE_LIMITED" | "TIME_BUDGET";

export type BulkForceRefreshResult = {
  eligible: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  skippedByReason: Record<BulkSkipReason, number>;
  failures: Array<{ characterId: string; label: string; errorCategory: CharacterSyncErrorCode; errorLabel: string }>;
  skippedCharacters: Array<{ characterId: string; label: string; reason: BulkSkipReason }>;
  durationMs: number;
};

async function resolveSyncTarget(characterId: string) {
  const character = await characterRepository.findById(characterId);
  if (!character) {
    throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
  }
  const reason = syncIneligibleReason({ isActive: character.isActive });
  if (reason) {
    throw new DomainError("CHARACTER_SYNC_NOT_ELIGIBLE", SYNC_INELIGIBLE_COPY[reason], 400);
  }
  // The connection is always the CHARACTER OWNER's — never the acting admin's.
  // Linked + connected → VERIFIED sync; otherwise PUBLIC (connectionId null).
  const ownerConnection = await battleNetConnectionRepository.findByUserAndRegion(character.userId, character.region);
  const connectionId = verifiedConnectionId(character, ownerConnection);
  const owner = await userRepository.findById(character.userId);
  if (!owner) {
    throw new DomainError("USER_NOT_FOUND", "Character owner was not found.", 404);
  }
  return { character, connectionId, owner: { id: owner.id, name: owner.name } };
}

export const characterOperationsService = {
  async getListPage(admin: AuthenticatedUser, filters: CharacterOperationsFilters, now: Date = new Date()) {
    assertCanManageCharacterOperations(admin);
    const { characters, connections } = await characterOperationsRepository.listAll();
    const staleMinutes = resolveSyncHealthStaleMinutes();
    const all = characters.map((record) =>
      deriveOperationsRow(record, {
        ownerHasRegionConnection: connections.has(connectionKey(record.userId, record.region)),
        now,
        staleMinutes,
      }),
    );
    const rows = sortOperationsRows(filterOperationsRows(all, filters), filters.sort);
    return {
      filters,
      summary: summarizeOperationsRows(all),
      rows,
      bulkEligibleCount: all.filter((row) => row.syncIneligibleReason === null).length,
      staleMinutes,
    };
  },

  async getDetail(admin: AuthenticatedUser, characterId: string, now: Date = new Date()) {
    assertCanManageCharacterOperations(admin);
    const found = await characterOperationsRepository.findById(characterId);
    if (!found) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    const { character, ownerHasRegionConnection } = found;
    const row = deriveOperationsRow(character, {
      ownerHasRegionConnection,
      now,
      staleMinutes: resolveSyncHealthStaleMinutes(),
    });
    const [availabilityById, qualifications] = await Promise.all([
      characterWeeklyAvailabilityService.projectCurrentForCharacters([{ id: character.id, region: character.region }]),
      boosterQualificationRepository.listByUserId(character.userId),
    ]);
    return {
      row,
      identity: {
        primaryRole: character.primaryRole,
        blizzardCharacterId: character.blizzardCharacterId,
        blizzardRealmId: character.blizzardRealmId,
        ownerHasRegionConnection,
      },
      currentReset: getRegionalWeeklyReset(character.region).resetIdentifier,
      weeklyAvailability: availabilityById.get(character.id) ?? null,
      boosterAccess: boosterQualificationService.buildAccountAccessPanel(qualifications),
    };
  },

  /**
   * Admin "Sync now" (force=false) and "Force refresh" (force=true). Both use
   * the SAME syncLinkedCharacterProfile (telemetry + per-Character lock) with
   * the owner's regional connection. Force only skips the normal 60s manual
   * cooldown; eligibility, identity checks, rate-limit handling and locking
   * are unchanged. Eligibility / cooldown / already-syncing throw; a real
   * sync failure is returned as a safe category.
   */
  async syncCharacter(
    admin: AuthenticatedUser,
    input: { characterId: string; force: boolean },
  ): Promise<AdminSyncOutcome> {
    assertCanManageCharacterOperations(admin);
    const { character, connectionId, owner } = await resolveSyncTarget(input.characterId);
    const remaining = manualCooldownRemainingMs(character);
    if (!input.force && remaining > 0) {
      throw new DomainError(
        "BLIZZARD_REFRESH_COOLDOWN",
        `Wait ${Math.ceil(remaining / 1000)}s before syncing again (60s between normal syncs). Force refresh bypasses this.`,
        429,
      );
    }
    const trigger: CharacterSyncTrigger = input.force ? "ADMIN_FORCE" : "ADMIN_SYNC";
    const eventType = input.force ? "ADMIN_CHARACTER_FORCE_REFRESH" : "ADMIN_CHARACTER_SYNC";
    const verb = input.force ? "Force refreshed" : "Synced";
    const label = characterLabel(character);
    try {
      const result = await syncLinkedCharacterProfile(owner, character, connectionId, {
        trigger,
        writeActivity: false,
      });
      await activityRepository.create({
        userId: admin.id,
        type: eventType,
        message: `${verb} ${label} from Blizzard: succeeded. targetCharacterId=${character.id}`,
      });
      return { status: "SUCCEEDED", lockoutSynced: result.lockoutSynced, label };
    } catch (error) {
      if (isDomainError(error) && error.code === "CHARACTER_SYNC_IN_PROGRESS") throw error;
      const errorCategory = classifySyncError(error);
      await activityRepository.create({
        userId: admin.id,
        type: eventType,
        message: `${verb} ${label} from Blizzard: failed (${errorCategory}). targetCharacterId=${character.id}`,
      });
      return { status: "FAILED", errorCategory, errorLabel: CHARACTER_SYNC_ERROR_LABELS[errorCategory], label };
    }
  },

  /**
   * "Force refresh all": every eligible Character (every active Character,
   * VERIFIED or PUBLIC — the scheduler's own eligibility, resolved
   * server-side now), bypassing freshness. Runs synchronously under the SAME
   * whole-job advisory lock as the scheduler, so the two never overlap; a
   * durable 10-minute cooldown (latest STARTED ActivityEvent, checked and
   * written under that lock) starts when a run is accepted. Concurrency 4,
   * ~120s work budget, stop starting work after the first 429, per-Character
   * lock skips, one failure never aborts the batch.
   */
  async forceRefreshAll(
    admin: AuthenticatedUser,
    options: { workBudgetMs?: number; concurrency?: number } = {},
  ): Promise<BulkForceRefreshResult> {
    assertCanManageCharacterOperations(admin);
    if (!isBlizzardConfigured()) {
      throw new DomainError("BATTLENET_NOT_CONFIGURED", "Battle.net integration is not configured.", 503);
    }
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    if (!handle) {
      throw new DomainError("CHARACTER_SYNC_ALREADY_RUNNING", "Character synchronization is already in progress.", 409);
    }
    try {
      const last = await activityRepository.findLatestByType(BULK_FORCE_REFRESH_STARTED_EVENT);
      if (last) {
        const remaining = BULK_FORCE_REFRESH_COOLDOWN_MS - (Date.now() - new Date(last.occurredAt).getTime());
        if (remaining > 0) {
          throw new DomainError(
            "CHARACTER_BULK_REFRESH_COOLDOWN",
            `Force refresh all ran recently. Try again in ${Math.ceil(remaining / 60_000)} min.`,
            429,
          );
        }
      }

      const start = Date.now();
      const deadline = start + (options.workBudgetMs ?? BULK_FORCE_REFRESH_WORK_BUDGET_MS);
      // Same eligibility as the scheduler, without its freshness filter.
      const candidates = await characterRepository.listScheduledSyncCandidates({
        staleBefore: new Date(start + 24 * 60 * 60_000).toISOString(),
      });
      // The cooldown starts when the run is accepted, not only on success.
      await activityRepository.create({
        userId: admin.id,
        type: BULK_FORCE_REFRESH_STARTED_EVENT,
        message: `Started Force refresh all for ${candidates.length} eligible characters.`,
      });

      const rateLimited = { current: false };
      type Outcome =
        | { kind: "succeeded"; connectionId: string | null; characterId: string }
        | { kind: "failed"; category: CharacterSyncErrorCode }
        | { kind: "skipped"; reason: BulkSkipReason };
      const outcomes = await mapWithConcurrency(
        candidates,
        options.concurrency ?? BULK_FORCE_REFRESH_CONCURRENCY,
        async (candidate): Promise<Outcome> => {
          if (rateLimited.current) return { kind: "skipped", reason: "RATE_LIMITED" };
          if (Date.now() > deadline) return { kind: "skipped", reason: "TIME_BUDGET" };
          try {
            const connectionId = candidate.connection?.id ?? null;
            await syncLinkedCharacterProfile(candidate.owner, candidate.character, connectionId, {
              updateConnectionSync: false,
              writeActivity: false,
              autoLinkWarcraftLogs: false,
              trigger: "ADMIN_BULK_FORCE",
            });
            return { kind: "succeeded", connectionId, characterId: candidate.character.id };
          } catch (error) {
            if (isDomainError(error) && error.code === "CHARACTER_SYNC_IN_PROGRESS") {
              return { kind: "skipped", reason: "ALREADY_SYNCING" };
            }
            const category = classifySyncError(error);
            if (category === "RATE_LIMITED") rateLimited.current = true;
            return { kind: "failed", category };
          }
        },
      );

      const result: BulkForceRefreshResult = {
        eligible: candidates.length,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        skippedByReason: { ALREADY_SYNCING: 0, RATE_LIMITED: 0, TIME_BUDGET: 0 },
        failures: [],
        skippedCharacters: [],
        durationMs: 0,
      };
      const succeededConnectionIds = new Set<string>();
      const succeededCharacterIds: string[] = [];
      outcomes.forEach((outcome, index) => {
        const character = candidates[index]!.character;
        const label = characterLabel(character);
        if (outcome.kind === "succeeded") {
          result.attempted += 1;
          result.succeeded += 1;
          if (outcome.connectionId) succeededConnectionIds.add(outcome.connectionId);
          succeededCharacterIds.push(outcome.characterId);
        } else if (outcome.kind === "failed") {
          result.attempted += 1;
          result.failed += 1;
          result.failures.push({
            characterId: character.id,
            label,
            errorCategory: outcome.category,
            errorLabel: CHARACTER_SYNC_ERROR_LABELS[outcome.category],
          });
        } else {
          result.skipped += 1;
          result.skippedByReason[outcome.reason] += 1;
          result.skippedCharacters.push({ characterId: character.id, label, reason: outcome.reason });
        }
      });

      const syncedAt = new Date().toISOString();
      for (const connectionId of succeededConnectionIds) {
        await battleNetConnectionRepository.markSuccessfulSync(connectionId, syncedAt);
      }
      await characterWarcraftLogsService.tryAutoLinkManyIfMissing(succeededCharacterIds);

      result.durationMs = Date.now() - start;
      await activityRepository.create({
        userId: admin.id,
        type: BULK_FORCE_REFRESH_COMPLETED_EVENT,
        message:
          `Force refresh all: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped ` +
          `of ${result.eligible} eligible (${Math.round(result.durationMs / 1000)}s).`,
      });
      return result;
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};
