import { db, orm } from "@/lib/prisma";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
  ParticipationType,
  RaidDifficulty,
  RunStatus,
  SignupStatus,
  WowClass,
  WowRegion,
} from "@/models/enums";
import { UPCOMING_RUN_STATUSES } from "@/models/enums";
import { projectRunContentDisplay } from "@/lib/run-content-presets";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapLootbuddyMode,
  mapLootbuddyVerification,
  mapParticipation,
  mapRegion,
  mapRunStatus,
  mapSignupStatus,
  mapWowClass,
} from "@/lib/persistence";
import { DomainError } from "@/lib/errors";
import { normalizeOfferedRoles } from "@/lib/offered-roles";

export type SignupListRecord = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  isBackup: boolean;
  /** Every role this BOOSTER offer volunteers for, TANK → HEALER → DPS. Always empty for LOOTBUDDY. */
  offeredRoles: CharacterRole[];
  /** Live published BOOSTER role; null unless SELECTED booster. */
  publishedRole: CharacterRole | null;
  /** Own Class snapshot for a characterless Lootbuddy row; null for BOOSTER and for legacy Character-backed Lootbuddy rows (fall back to character.wowClass for those). */
  lootbuddyClass: WowClass | null;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
  character: {
    id: string;
    name: string;
    realm: string;
    region: WowRegion;
    wowClass: WowClass;
  } | null;
  run: {
    id: string;
    title: string;
    status: RunStatus;
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    productLabel: string;
    contentSummary: string;
  };
};

/** Character-scoped BoostingHub reservation (draft-selected or published SELECTED). */
export type CharacterReservationCommitmentRow = {
  signupId: string;
  characterId: string;
  status: SignupStatus;
  draftSelected: boolean;
  selectedRole: CharacterRole | null;
  publishedRole: CharacterRole | null;
  run: SignupListRecord["run"];
};

/** Reads a `RunSignupRole[]` relation payload into a deterministically ordered role list. */
export function mapOfferedRoles(value: unknown): CharacterRole[] {
  if (!Array.isArray(value)) return [];
  return normalizeOfferedRoles(
    value.map((item) => mapCharacterRole((item as Record<string, unknown>).role)),
  );
}

function mapSignup(row: Record<string, unknown>): SignupListRecord {
  const run = (row.run ?? {}) as Record<string, unknown>;
  const character = row.character ? (row.character as Record<string, unknown>) : null;
  const contentRows = Array.isArray(run.contents) ? run.contents : [];
  const contents = contentRows.map((item) => {
    const content = item as Record<string, unknown>;
    const contentRaid = (content.raid ?? {}) as Record<string, unknown>;
    const bosses = Array.isArray(contentRaid.bosses) ? contentRaid.bosses : [];
    return {
      raidId: asString(content.raidId ?? contentRaid.id),
      raidName: asString(contentRaid.name, "Unknown raid"),
      sortOrder: asNumber(content.sortOrder),
      plannedBossCount: asNumber(content.plannedBossCount),
      totalBossCount: bosses.length,
    };
  });
  if (contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run has no persisted raid content.");
  }
  const display = projectRunContentDisplay(contents);

  return {
    id: asString(row.id),
    userId: asString(row.userId),
    status: mapSignupStatus(row.status),
    participationType: mapParticipation(row.participationType),
    isBackup: asBoolean(row.isBackup),
    offeredRoles: mapOfferedRoles(row.offeredRoles),
    publishedRole: row.publishedRole == null ? null : mapCharacterRole(row.publishedRole),
    lootbuddyClass: row.lootbuddyClass == null ? null : mapWowClass(row.lootbuddyClass),
    lootbuddyMode: row.lootbuddyMode == null ? null : mapLootbuddyMode(row.lootbuddyMode),
    lootbuddyVerification:
      row.lootbuddyVerification == null ? null : mapLootbuddyVerification(row.lootbuddyVerification),
    character: character
      ? {
          id: asString(character.id),
          name: asString(character.name),
          realm: asString(character.realm),
          region: mapRegion(character.region),
          wowClass: mapWowClass(character.wowClass),
        }
      : null,
    run: {
      id: asString(run.id),
      title: asString(run.title),
      status: mapRunStatus(run.status),
      difficulty: mapDifficulty(run.difficulty),
      scheduledStartAt: asString(run.scheduledStartAt),
      productLabel: display.productLabel,
      contentSummary: display.summary,
    },
  };
}

export type ReservationConflictRow = {
  characterId: string;
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
};

/**
 * Minimum gap between two Run start times for the same Character to be
 * draft-selected / SELECTED on both. Runs closer than this collide for
 * cross-Run reservation. Exactly 2h apart is allowed.
 */
export const CROSS_RUN_RESERVATION_MIN_GAP_MS = 2 * 60 * 60 * 1000;

export function scheduledStartsCollideForReservation(
  scheduledStartAtA: string | Date | number,
  scheduledStartAtB: string | Date | number,
  minGapMs: number = CROSS_RUN_RESERVATION_MIN_GAP_MS,
): boolean {
  const a = typeof scheduledStartAtA === "number" ? scheduledStartAtA : new Date(scheduledStartAtA).getTime();
  const b = typeof scheduledStartAtB === "number" ? scheduledStartAtB : new Date(scheduledStartAtB).getTime();
  return Math.abs(a - b) < minGapMs;
}

/**
 * Cross-Run Character reservation (double-booking) check. A Character is
 * reserved on a Run when either its signup is draft-selected into that Run's
 * roster (a RunRosterEntry with `selected: true`) or its RunSignup.status is
 * SELECTED — the same underlying business rule, never counted twice for the
 * same Run. Only Runs still occupying a real scheduling slot
 * (UPCOMING_RUN_STATUSES) can hold a reservation; the target Run itself is
 * always excluded (editing an existing signup is never a conflict with
 * itself). Collision: another upcoming Run's start is within
 * {@link CROSS_RUN_RESERVATION_MIN_GAP_MS} (2 hours) of the target start —
 * compared by parsed time rather than raw string equality since the Run
 * model has no authoritative end time yet.
 *
 * Exported (not a `signupRepository` method) so `roster.repository.ts` can
 * re-run the same check with a transaction's own `txOrm` for a race-safe
 * re-verification immediately before a write, exactly like the existing
 * WITHDRAWN-race checks in this file's `applyOfferPlan`.
 */
export type ReservationConflictQueryInput = {
  characterIds: string[];
  scheduledStartAt: string;
  /** When set, that Run is never treated as a conflict (roster/signup editing self). */
  excludeRunId?: string;
};

export async function queryReservationConflicts(
  ormLike: TxOrm,
  input: ReservationConflictQueryInput,
): Promise<ReservationConflictRow[]> {
  if (input.characterIds.length === 0) {
    return [];
  }
  const targetTime = new Date(input.scheduledStartAt).getTime();

  const rows = await ormLike.RunSignup
    .where((f) => f.characterId.in(input.characterIds))
    .include("run")
    .include("rosterEntries")
    .all();

  const conflicts = new Map<string, ReservationConflictRow>();
  for (const raw of rows as Record<string, unknown>[]) {
    const characterId = asStringOrNull(raw.characterId);
    if (!characterId || conflicts.has(characterId)) continue;

    const run = (raw.run ?? {}) as Record<string, unknown>;
    const runId = asString(run.id);
    if (input.excludeRunId && runId === input.excludeRunId) continue;
    if (!scheduledStartsCollideForReservation(asString(run.scheduledStartAt), targetTime)) continue;
    if (!UPCOMING_RUN_STATUSES.includes(mapRunStatus(run.status))) continue;

    const status = mapSignupStatus(raw.status);
    if (status === "WITHDRAWN") continue;

    const rosterEntries = Array.isArray(raw.rosterEntries) ? (raw.rosterEntries as Record<string, unknown>[]) : [];
    const draftSelected = rosterEntries.some((entry) => asBoolean(entry.selected, true));
    if (status !== "SELECTED" && !draftSelected) continue;

    conflicts.set(characterId, {
      characterId,
      runId,
      runTitle: asString(run.title),
      scheduledStartAt: asString(run.scheduledStartAt),
    });
  }

  return [...conflicts.values()];
}

/**
 * Like {@link queryReservationConflicts}, but returns every colliding Run for
 * each Character (schedule-integrity diagnostics). Order is undefined —
 * callers must sort deterministically.
 */
export async function queryAllReservationConflicts(
  ormLike: TxOrm,
  input: ReservationConflictQueryInput,
): Promise<ReservationConflictRow[]> {
  if (input.characterIds.length === 0) {
    return [];
  }
  const targetTime = new Date(input.scheduledStartAt).getTime();

  const rows = await ormLike.RunSignup
    .where((f) => f.characterId.in(input.characterIds))
    .include("run")
    .include("rosterEntries")
    .all();

  const conflicts: ReservationConflictRow[] = [];
  const seen = new Set<string>();
  for (const raw of rows as Record<string, unknown>[]) {
    const characterId = asStringOrNull(raw.characterId);
    if (!characterId) continue;

    const run = (raw.run ?? {}) as Record<string, unknown>;
    const runId = asString(run.id);
    if (input.excludeRunId && runId === input.excludeRunId) continue;
    if (!scheduledStartsCollideForReservation(asString(run.scheduledStartAt), targetTime)) continue;
    if (!UPCOMING_RUN_STATUSES.includes(mapRunStatus(run.status))) continue;

    const status = mapSignupStatus(raw.status);
    if (status === "WITHDRAWN") continue;

    const rosterEntries = Array.isArray(raw.rosterEntries) ? (raw.rosterEntries as Record<string, unknown>[]) : [];
    const draftSelected = rosterEntries.some((entry) => asBoolean(entry.selected, true));
    if (status !== "SELECTED" && !draftSelected) continue;

    const key = `${characterId}:${runId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({
      characterId,
      runId,
      runTitle: asString(run.title),
      scheduledStartAt: asString(run.scheduledStartAt),
    });
  }

  return conflicts;
}

export type SignupWriteInput = {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  /** The volunteered BOOSTER role set; empty for LOOTBUDDY. Persisted as RunSignupRole rows. */
  offeredRoles: CharacterRole[];
  isBackup: boolean;
  status: SignupStatus;
  lootbuddyClass: WowClass | null;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
};

/**
 * Reconciles one signup's RunSignupRole rows towards the desired set inside an
 * open transaction: roles that stay keep their existing row (and createdAt), so
 * changing a role set never withdraws and recreates the offer itself.
 */
async function syncOfferedRoles(
  ormLike: TxOrm,
  signupId: string,
  offeredRoles: readonly CharacterRole[],
  now: string,
) {
  const desired = new Set(normalizeOfferedRoles(offeredRoles));
  const existing = (await ormLike.RunSignupRole.where({ signupId }).all()) as Record<string, unknown>[];
  const current = new Set<CharacterRole>();

  for (const row of existing) {
    const role = mapCharacterRole(row.role);
    if (desired.has(role)) {
      current.add(role);
      continue;
    }
    await ormLike.RunSignupRole.where({ id: asString(row.id) }).delete();
  }
  for (const role of desired) {
    if (current.has(role)) continue;
    await ormLike.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId,
      role,
      createdAt: now,
    });
  }
}

export const signupRepository = {
  async findReservationConflicts(input: ReservationConflictQueryInput): Promise<ReservationConflictRow[]> {
    return queryReservationConflicts(orm, input);
  },

  async findAllReservationConflicts(
    input: ReservationConflictQueryInput,
  ): Promise<ReservationConflictRow[]> {
    return queryAllReservationConflicts(orm, input);
  },

  async listByUserId(userId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ userId })
      .include("run", (run) =>
        run
          .include("raidLead")
          .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("character")
      .include("offeredRoles")
      .orderBy((signup) => signup.createdAt.desc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },

  /**
   * Upcoming BoostingHub reservations for one Character.
   * Reserving = published SELECTED or draft-selected roster entry.
   * PENDING-only offers are excluded (they do not reserve).
   */
  async listReservingCommitmentsByCharacterId(
    characterId: string,
  ): Promise<CharacterReservationCommitmentRow[]> {
    const byCharacter = await this.listReservingCommitmentsByCharacterIds({
      characterIds: [characterId],
    });
    return byCharacter;
  },

  /**
   * Batched upcoming BoostingHub reservations for many Characters.
   * Same reserving predicate as {@link listReservingCommitmentsByCharacterId}.
   * No schedule-window filter — callers that need conflict-only rows must use
   * {@link findAllReservationConflicts} separately.
   * Sorted by scheduledStartAt ASC, then runId ASC.
   */
  async listReservingCommitmentsByCharacterIds(input: {
    characterIds: string[];
    excludeRunId?: string;
  }): Promise<CharacterReservationCommitmentRow[]> {
    if (input.characterIds.length === 0) {
      return [];
    }

    const signups = await orm.RunSignup
      .where((f) => f.characterId.in(input.characterIds))
      .include("run", (run) =>
        run.include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("rosterEntries")
      .all();

    const commitments: CharacterReservationCommitmentRow[] = [];
    const seen = new Set<string>();

    for (const raw of signups as Record<string, unknown>[]) {
      if (mapParticipation(raw.participationType) !== "BOOSTER") continue;

      const mapped = mapSignup(raw);
      const characterId = asStringOrNull(raw.characterId);
      if (!characterId) continue;
      if (input.excludeRunId && mapped.run.id === input.excludeRunId) continue;
      if (!UPCOMING_RUN_STATUSES.includes(mapped.run.status)) continue;
      if (mapped.status === "WITHDRAWN") continue;

      const rosterEntries = Array.isArray(raw.rosterEntries)
        ? (raw.rosterEntries as Record<string, unknown>[])
        : [];
      const selectedEntry = rosterEntries.find((entry) => asBoolean(entry.selected, true));
      const draftSelected = Boolean(selectedEntry);
      if (mapped.status !== "SELECTED" && !draftSelected) continue;

      const key = `${characterId}:${mapped.run.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      commitments.push({
        signupId: mapped.id,
        characterId,
        status: mapped.status,
        draftSelected,
        selectedRole:
          selectedEntry?.selectedRole == null
            ? null
            : mapCharacterRole(selectedEntry.selectedRole),
        publishedRole: mapped.publishedRole,
        run: mapped.run,
      });
    }

    return commitments.sort(
      (a, b) =>
        new Date(a.run.scheduledStartAt).getTime() - new Date(b.run.scheduledStartAt).getTime() ||
        a.run.id.localeCompare(b.run.id),
    );
  },

  async findById(id: string): Promise<SignupListRecord | null> {
    const signup = await orm.RunSignup
      .where({ id })
      .include("run", (run) =>
        run
          .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("character")
      .include("offeredRoles")
      .first();

    return signup ? mapSignup(signup as Record<string, unknown>) : null;
  },

  async findDuplicate(input: {
    runId: string;
    userId: string;
    characterId: string;
    participationType: ParticipationType;
  }): Promise<SignupListRecord | null> {
    const signup = await orm.RunSignup
      .where({
        runId: input.runId,
        userId: input.userId,
        characterId: input.characterId,
        participationType: input.participationType,
      })
      .include("run", (run) =>
        run
          .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("character")
      .include("offeredRoles")
      .first();

    return signup ? mapSignup(signup as Record<string, unknown>) : null;
  },

  /** The signup row and its offered-role rows are written together — a BOOSTER offer is never briefly roleless. */
  async create(input: SignupWriteInput): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      await txOrm.RunSignup.create({
        id,
        runId: input.runId,
        userId: input.userId,
        characterId: input.characterId,
        participationType: input.participationType,
        isBackup: input.isBackup,
        status: input.status,
        publishedRole: null,
        lootbuddyClass: input.lootbuddyClass,
        lootbuddyMode: input.lootbuddyMode,
        lootbuddyVerification: input.lootbuddyVerification,
        createdAt: now,
        updatedAt: now,
      });
      await syncOfferedRoles(txOrm, id, input.offeredRoles, now);
    });

    return { id };
  },

  async update(id: string, input: Partial<SignupWriteInput>) {
    const patch: Record<string, unknown> = {};
    if (input.characterId !== undefined) patch.characterId = input.characterId;
    if (input.participationType !== undefined) patch.participationType = input.participationType;
    if (input.isBackup !== undefined) patch.isBackup = input.isBackup;
    if (input.status !== undefined) {
      patch.status = input.status;
      // publishedRole is only meaningful for SELECTED BOOSTERs — clear it on any
      // status write so WITHDRAWN / PENDING / NOT_SELECTED never keep a stale role.
      if (input.status !== "SELECTED") {
        patch.publishedRole = null;
      }
    }
    if (input.lootbuddyClass !== undefined) patch.lootbuddyClass = input.lootbuddyClass;
    if (input.lootbuddyMode !== undefined) patch.lootbuddyMode = input.lootbuddyMode;
    if (input.lootbuddyVerification !== undefined) patch.lootbuddyVerification = input.lootbuddyVerification;

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      if (Object.keys(patch).length > 0) {
        await txOrm.RunSignup.where({ id }).update(patch);
      }
      if (input.offeredRoles !== undefined) {
        await syncOfferedRoles(txOrm, id, input.offeredRoles, new Date().toISOString());
      }
    });
  },

  async listByRunId(runId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ runId })
      .include("run", (run) =>
        run
          .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("character")
      .include("offeredRoles")
      .orderBy((signup) => signup.createdAt.asc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },

  /** All of one User's signup rows on one Run, every status included — the full offer history. */
  async listByRunAndUser(runId: string, userId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ runId, userId })
      .include("run", (run) =>
        run
          .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses"))),
      )
      .include("character")
      .include("offeredRoles")
      .orderBy((signup) => signup.createdAt.asc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },

  /**
   * Executes one already-authorized, already-eligibility-checked BOOSTER
   * reconciliation plan atomically. Never touches LOOTBUDDY rows — see
   * `applyLootbuddyPlan` for that participation type's own atomic apply. Each
   * planned mutation re-checks the row's current status against fresh
   * in-transaction reads immediately before writing it, so a concurrent
   * change (e.g. another request reactivating the same WITHDRAWN row) fails
   * the whole transaction instead of corrupting state — the plan itself is
   * not recomputed here, only defended at the row level.
   */
  async applyOfferPlan(input: {
    runId: string;
    userId: string;
    /** Required only to re-verify cross-Run reservation for offers newly becoming active. */
    scheduledStartAt: string;
    toWithdraw: string[];
    toReactivate: Array<{ id: string; characterId: string; offeredRoles: CharacterRole[] }>;
    toCreate: Array<{ characterId: string; offeredRoles: CharacterRole[] }>;
    /** Kept offers whose volunteered role set changed — reconciled in place, never withdrawn and recreated. */
    toUpdateRoles: Array<{ id: string; offeredRoles: CharacterRole[] }>;
  }): Promise<{ created: string[]; reactivated: string[]; withdrawn: string[] }> {
    const created: string[] = [];
    const reactivated: string[] = [];
    const withdrawn: string[] = [];

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const now = new Date().toISOString();

      /**
       * Race-safety net immediately before the write: the caller already
       * checked cross-Run reservation (with a richer, per-Character error)
       * before opening this transaction, but another request could have
       * reserved the same Character elsewhere in between. Only Characters
       * newly becoming active (reactivated or created) can newly conflict —
       * a `kept` row that already existed is not creating a new reservation
       * here.
       */
      const activatingCharacterIds = [
        ...input.toReactivate.map((offer) => offer.characterId),
        ...input.toCreate.map((offer) => offer.characterId),
      ];
      if (activatingCharacterIds.length > 0) {
        const conflicts = await queryReservationConflicts(txOrm, {
          characterIds: activatingCharacterIds,
          excludeRunId: input.runId,
          scheduledStartAt: input.scheduledStartAt,
        });
        if (conflicts.length > 0) {
          throw new DomainError(
            "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
            conflicts.length === 1
              ? `That character was just selected for ${conflicts[0].runTitle}. Please try again.`
              : "Those characters were just selected for other runs. Please try again.",
          );
        }
      }

      for (const id of input.toWithdraw) {
        const row = await txOrm.RunSignup.where({ id }).first();
        if (!row) continue;
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status === "WITHDRAWN") continue;
        await txOrm.RunSignup.where({ id }).update({
          status: "WITHDRAWN",
          publishedRole: null,
          updatedAt: now,
        });
        withdrawn.push(id);
      }

      for (const offer of input.toReactivate) {
        const row = await txOrm.RunSignup.where({ id: offer.id }).first();
        if (!row) {
          throw new DomainError("NOT_FOUND", "A previously offered character was removed.");
        }
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status !== "WITHDRAWN") {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            "This offer changed since it was loaded. Please try again.",
          );
        }
        await txOrm.RunSignup.where({ id: offer.id }).update({
          status: "PENDING",
          publishedRole: null,
          isBackup: false,
          updatedAt: now,
        });
        await syncOfferedRoles(txOrm, offer.id, offer.offeredRoles, now);
        reactivated.push(offer.id);
      }

      for (const offer of input.toCreate) {
        const id = crypto.randomUUID();
        await txOrm.RunSignup.create({
          id,
          runId: input.runId,
          userId: input.userId,
          characterId: offer.characterId,
          participationType: "BOOSTER",
          isBackup: false,
          status: "PENDING",
          publishedRole: null,
          lootbuddyClass: null,
          lootbuddyMode: null,
          lootbuddyVerification: null,
          createdAt: now,
          updatedAt: now,
        });
        await syncOfferedRoles(txOrm, id, offer.offeredRoles, now);
        created.push(id);
      }

      for (const update of input.toUpdateRoles) {
        await syncOfferedRoles(txOrm, update.id, update.offeredRoles, now);
        await txOrm.RunSignup.where({ id: update.id }).update({ updatedAt: now });
      }
    });

    return { created, reactivated, withdrawn };
  },

  /**
   * Executes one already-authorized LOOTBUDDY desired-set reconciliation plan
   * atomically. Identity is `RunSignup.id`, never Class+Mode — two entries
   * with the same Class and Mode create two distinct rows. Never touches
   * BOOSTER rows, and never checks cross-Run Character reservation (a
   * characterless Lootbuddy has no Character to reserve — see the audit note
   * in signup.service.ts). `toUpdate`/`toCreate` are keyed by the desired
   * entry's own array position so the caller's per-entry Class/Mode/
   * verification lines up with the row that ends up representing it.
   */
  async applyLootbuddyPlan(input: {
    runId: string;
    userId: string;
    toWithdraw: string[];
    toUpdate: Array<{
      id: string;
      lootbuddyClass: WowClass;
      lootbuddyMode: LootbuddyMode;
      lootbuddyVerification: LootbuddyVerification;
    }>;
    toCreate: Array<{
      lootbuddyClass: WowClass;
      lootbuddyMode: LootbuddyMode;
      lootbuddyVerification: LootbuddyVerification;
    }>;
  }): Promise<{ created: string[]; updated: string[]; withdrawn: string[] }> {
    const created: string[] = [];
    const updated: string[] = [];
    const withdrawn: string[] = [];

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const now = new Date().toISOString();

      for (const id of input.toWithdraw) {
        const row = await txOrm.RunSignup.where({ id }).first();
        if (!row) continue;
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status === "WITHDRAWN") continue;
        await txOrm.RunSignup.where({ id }).update({
          status: "WITHDRAWN",
          publishedRole: null,
          updatedAt: now,
        });
        withdrawn.push(id);
      }

      for (const entry of input.toUpdate) {
        const row = await txOrm.RunSignup.where({ id: entry.id }).first();
        if (!row) {
          throw new DomainError("NOT_FOUND", "A previously staged lootbuddy entry was removed.");
        }
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status === "WITHDRAWN") {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            "This lootbuddy entry changed since it was loaded. Please try again.",
          );
        }
        await txOrm.RunSignup.where({ id: entry.id }).update({
          lootbuddyClass: entry.lootbuddyClass,
          lootbuddyMode: entry.lootbuddyMode,
          lootbuddyVerification: entry.lootbuddyVerification,
          updatedAt: now,
        });
        updated.push(entry.id);
      }

      for (const entry of input.toCreate) {
        const id = crypto.randomUUID();
        await txOrm.RunSignup.create({
          id,
          runId: input.runId,
          userId: input.userId,
          characterId: null,
          participationType: "LOOTBUDDY",
          isBackup: false,
          status: "PENDING",
          publishedRole: null,
          lootbuddyClass: entry.lootbuddyClass,
          lootbuddyMode: entry.lootbuddyMode,
          lootbuddyVerification: entry.lootbuddyVerification,
          createdAt: now,
          updatedAt: now,
        });
        created.push(id);
      }
    });

    return { created, updated, withdrawn };
  },
};

type TxOrm = typeof orm;
