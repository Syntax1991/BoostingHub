import { parseKilledBossIds } from "@/lib/lockout-bosses";
import { db, orm } from "@/lib/prisma";
import {
  asBoolean,
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapRegion,
  mapWowClass,
  mapCharacterSyncErrorCode,
} from "@/lib/persistence";
import type { BoosterQualificationRecord, ScheduledCharacterSyncCandidate } from "@/models/records";
import type { CharacterRole, CharacterSyncErrorCode, WowClass, WowRegion } from "@/models/enums";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";

export type CharacterPageRecord = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: ReturnType<typeof mapRegion>;
  normalizedName: string;
  normalizedRealm: string;
  wowClass: ReturnType<typeof mapWowClass>;
  specialization: string | null;
  primaryRole: ReturnType<typeof mapCharacterRole>;
  /** Blizzard-authoritative equipped item level. Null when Blizzard has not supplied one. */
  itemLevel: number | null;
  isActive: boolean;
  /** Last successful Blizzard sync. */
  lastSyncedAt: string | null;
  /** Start of the latest real sync attempt (manual cooldown basis). */
  lastSyncAttemptAt: string | null;
  /** Latest failed attempt; null after a success. */
  lastSyncErrorAt: string | null;
  lastSyncErrorCode: CharacterSyncErrorCode | null;
  /** Consecutive failed attempts. */
  syncFailureCount: number;
  blizzardCharacterId: string | null;
  blizzardRealmId: string | null;
  warcraftLogsId: string | null;
  createdAt: string;
  updatedAt: string;
  /** @deprecated Empty; prefer boosterQualifications. */
  boosterAccess: [];
  boosterQualifications: BoosterQualificationRecord[];
  lockouts: Array<{
    raidId: string;
    raid: { name: string };
    difficulty: ReturnType<typeof mapDifficulty>;
    resetIdentifier: string;
    isComplete: boolean;
    bossesDefeated: number;
    /** Catalog boss ids killed this reset; null when unknown (older sync). */
    killedBossIds?: string[] | null;
  }>;
};

export type CharacterCreateInput = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: WowRegion;
  normalizedName: string;
  normalizedRealm: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  /** Blizzard-authoritative; null when Blizzard has not supplied one yet. */
  itemLevel: number | null;
  isActive: boolean;
  blizzardCharacterId?: string | null;
  blizzardRealmId?: string | null;
  lastSyncedAt?: string | null;
};

/** Item level is never part of an edit — it is Blizzard-authoritative and frozen otherwise. */
export type CharacterUpdateInput = {
  name: string;
  realm: string;
  region: WowRegion;
  normalizedName: string;
  normalizedRealm: string;
  specialization: string;
  primaryRole: CharacterRole;
};

export type CharacterBlizzardLinkInput = {
  blizzardCharacterId: string;
  blizzardRealmId: string;
  specialization?: string;
  primaryRole?: CharacterRole;
  /** Omitted (not null) when Blizzard enrichment did not return one; existing value is preserved. */
  itemLevel?: number;
  lastSyncedAt?: string | null;
};

export type CharacterBlizzardSyncInput = {
  name: string;
  normalizedName: string;
  /** Omitted on transient Blizzard failure; existing value is preserved rather than cleared. */
  itemLevel?: number;
  lastSyncedAt: string;
};

function mapCharacter(character: Record<string, unknown>): CharacterPageRecord {
  const lockouts = Array.isArray(character.lockouts) ? character.lockouts : [];

  return {
    id: asString(character.id),
    userId: asString(character.userId),
    name: asString(character.name),
    realm: asString(character.realm),
    region: mapRegion(character.region),
    normalizedName: asString(character.normalizedName),
    normalizedRealm: asString(character.normalizedRealm),
    wowClass: mapWowClass(character.wowClass),
    specialization: asStringOrNull(character.specialization),
    primaryRole: mapCharacterRole(character.primaryRole),
    itemLevel: asNumberOrNull(character.itemLevel),
    isActive: asBoolean(character.isActive, true),
    lastSyncedAt: asStringOrNull(character.lastSyncedAt),
    lastSyncAttemptAt: asStringOrNull(character.lastSyncAttemptAt),
    lastSyncErrorAt: asStringOrNull(character.lastSyncErrorAt),
    lastSyncErrorCode: mapCharacterSyncErrorCode(character.lastSyncErrorCode),
    syncFailureCount: asNumber(character.syncFailureCount, 0),
    blizzardCharacterId: asStringOrNull(character.blizzardCharacterId),
    blizzardRealmId: asStringOrNull(character.blizzardRealmId),
    warcraftLogsId: asStringOrNull(character.warcraftLogsId),
    createdAt: asString(character.createdAt),
    updatedAt: asString(character.updatedAt),
    // Account-level qualifications are attached separately — never via Character relation.
    boosterAccess: [],
    boosterQualifications: [],
    lockouts: lockouts.map((row) => {
      const record = row as Record<string, unknown>;
      const raid = (record.raid ?? {}) as Record<string, unknown>;
      return {
        raidId: asString(record.raidId),
        raid: { name: asString(raid.name, "Unknown raid") },
        difficulty: mapDifficulty(record.difficulty),
        resetIdentifier: asString(record.resetIdentifier),
        isComplete: asBoolean(record.isComplete),
        bossesDefeated: asNumber(record.bossesDefeated),
        killedBossIds: parseKilledBossIds(record.killedBossIds),
      };
    }),
  };
}

/**
 * Attach account-level BoosterQualification rows for each Character's owner.
 * Eligibility is User + Difficulty; class filtering no longer applies.
 */
async function withAccountBoosterQualifications(
  characters: CharacterPageRecord[],
): Promise<CharacterPageRecord[]> {
  if (characters.length === 0) return characters;

  const userIds = [...new Set(characters.map((character) => character.userId))];
  const rows = await boosterQualificationRepository.listByUserIds(userIds);
  const qualificationsByUser = new Map<string, BoosterQualificationRecord[]>();
  for (const row of rows) {
    const list = qualificationsByUser.get(row.userId) ?? [];
    list.push(row);
    qualificationsByUser.set(row.userId, list);
  }

  return characters.map((character) => ({
    ...character,
    boosterAccess: [],
    boosterQualifications: qualificationsByUser.get(character.userId) ?? [],
  }));
}

export const characterRepository = {
  async listByUserId(userId: string): Promise<CharacterPageRecord[]> {
    const characters = await orm.Character
      .where({ userId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .orderBy((character) => character.name.asc())
      .all();

    return withAccountBoosterQualifications(
      characters.map((character) => mapCharacter(character as Record<string, unknown>)),
    );
  },

  async findById(characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterQualifications([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  async findOwnedById(userId: string, characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId, userId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterQualifications([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  /**
   * Scoped Blizzard identity: region + blizzardRealmId + blizzardCharacterId.
   */
  async findByBlizzardIdentity(
    region: WowRegion,
    blizzardRealmId: string,
    blizzardCharacterId: string,
  ): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({
        region,
        blizzardRealmId,
        blizzardCharacterId,
      })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterQualifications([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  /**
   * Owner-scoped identity lookup. Same name/realm on another region, or the
   * same identity owned by a different user, is not a conflict.
   */
  async findIdentityConflict(input: {
    userId: string;
    region: WowRegion;
    normalizedName: string;
    normalizedRealm: string;
    excludeId?: string;
  }): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({
        userId: input.userId,
        region: input.region,
        normalizedName: input.normalizedName,
        normalizedRealm: input.normalizedRealm,
      })
      .first();

    if (!character) {
      return null;
    }

    const mapped = mapCharacter(character as Record<string, unknown>);
    if (input.excludeId && mapped.id === input.excludeId) {
      return null;
    }

    return mapped;
  },

  async create(input: CharacterCreateInput): Promise<CharacterPageRecord> {
    const now = new Date().toISOString();
    await orm.Character.create({
      id: input.id,
      userId: input.userId,
      name: input.name,
      realm: input.realm,
      region: input.region,
      normalizedName: input.normalizedName,
      normalizedRealm: input.normalizedRealm,
      wowClass: input.wowClass,
      specialization: input.specialization,
      primaryRole: input.primaryRole,
      itemLevel: input.itemLevel == null ? null : Math.floor(input.itemLevel),
      isActive: input.isActive,
      blizzardCharacterId: input.blizzardCharacterId ?? null,
      blizzardRealmId: input.blizzardRealmId ?? null,
      lastSyncedAt: input.lastSyncedAt ?? null,
      // A verified import enrichment is a real Blizzard round-trip: it also
      // starts the manual refresh cooldown (lastSyncAttemptAt).
      lastSyncAttemptAt: input.lastSyncedAt ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Character create did not persist.");
    }
    return created;
  },

  async update(characterId: string, input: CharacterUpdateInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      name: input.name,
      realm: input.realm,
      region: input.region,
      normalizedName: input.normalizedName,
      normalizedRealm: input.normalizedRealm,
      specialization: input.specialization,
      primaryRole: input.primaryRole,
      updatedAt: new Date().toISOString(),
    });
  },

  async applyBlizzardLink(characterId: string, input: CharacterBlizzardLinkInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      blizzardCharacterId: input.blizzardCharacterId,
      blizzardRealmId: input.blizzardRealmId,
      ...(input.specialization ? { specialization: input.specialization } : {}),
      ...(input.primaryRole ? { primaryRole: input.primaryRole } : {}),
      ...(typeof input.itemLevel === "number" ? { itemLevel: Math.floor(input.itemLevel) } : {}),
      ...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
      // A verified link enrichment also starts the manual refresh cooldown.
      ...(input.lastSyncedAt ? { lastSyncAttemptAt: input.lastSyncedAt } : {}),
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * The success commit point of a Blizzard sync. Also clears the failure
   * telemetry in the SAME statement, so a verified profile and "no active
   * error" can never be persisted apart.
   */
  async applyBlizzardSync(characterId: string, input: CharacterBlizzardSyncInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      name: input.name,
      normalizedName: input.normalizedName,
      ...(typeof input.itemLevel === "number" ? { itemLevel: Math.floor(input.itemLevel) } : {}),
      lastSyncedAt: input.lastSyncedAt,
      lastSyncErrorAt: null,
      lastSyncErrorCode: null,
      syncFailureCount: 0,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Telemetry: a real sync attempt starts. Only lastSyncAttemptAt changes —
   * never lastSyncedAt — and Character.updatedAt (shown as "Updated") keeps
   * its value because bookkeeping is not a Character data change.
   */
  async recordSyncAttempt(characterId: string, attemptedAt: string): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      const row = (await txOrm.Character.where({ id: characterId }).select("updatedAt").first()) as
        | { updatedAt: string }
        | null;
      if (!row) return;
      await txOrm.Character.where({ id: characterId }).update({
        lastSyncAttemptAt: attemptedAt,
        updatedAt: row.updatedAt,
      });
    });
  },

  /**
   * Telemetry: the attempt failed. lastSyncedAt and every Character data
   * field stay untouched (last known good data remains). Callers hold the
   * Character's sync lock, so the read-then-increment cannot race another
   * attempt of the same Character.
   */
  async recordSyncFailure(characterId: string, input: { code: CharacterSyncErrorCode; failedAt: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      const row = (await txOrm.Character.where({ id: characterId }).select("syncFailureCount", "updatedAt").first()) as
        | { syncFailureCount: unknown; updatedAt: string }
        | null;
      if (!row) return;
      await txOrm.Character.where({ id: characterId }).update({
        lastSyncErrorAt: input.failedAt,
        lastSyncErrorCode: input.code,
        syncFailureCount: asNumber(row.syncFailureCount, 0) + 1,
        updatedAt: row.updatedAt,
      });
    });
  },

  async setActive(characterId: string, isActive: boolean): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Persist a discovered Warcraft Logs character identity.
   * External enrichment only — never part of user-editable Character fields.
   */
  async setWarcraftLogsId(characterId: string, warcraftLogsId: string): Promise<void> {
    const id = warcraftLogsId.trim();
    if (!id) {
      throw new Error("warcraftLogsId must be a non-empty string.");
    }
    await orm.Character.where({ id: characterId }).update({
      warcraftLogsId: id,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Global candidate list for the scheduled Blizzard character sync job:
   * active, Blizzard-linked characters whose owner has a BattleNetConnection
   * for that character's own region, and which are stale per `staleBefore`.
   *
   * Bounded to two queries regardless of how many characters/users exist —
   * one Character scan (with the owning User eager-loaded for attribution)
   * plus one batched BattleNetConnection lookup by the distinct owner ids —
   * so this never turns into a User -> Character -> connection N+1 scan.
   * Staleness itself (lastSyncedAt === null or older than staleBefore) is
   * filtered in-process because the ORM's public field-proxy API has no OR
   * combinator to express "null or older than X" as a single predicate.
   */
  async listScheduledSyncCandidates(input: {
    staleBefore: string;
  }): Promise<ScheduledCharacterSyncCandidate[]> {
    const linked = await orm.Character
      .where({ isActive: true })
      .where((character) => character.blizzardCharacterId.isNotNull())
      .where((character) => character.blizzardRealmId.isNotNull())
      .include("user")
      .all();

    const staleBeforeMs = new Date(input.staleBefore).getTime();
    const stale = linked.filter((row) => {
      const record = row as Record<string, unknown>;
      const lastSyncedAt = asStringOrNull(record.lastSyncedAt);
      // Compared as parsed timestamps, never as raw strings: the driver
      // round-trips TimestamptzString as Postgres's own text format (e.g.
      // "2026-09-12 12:32:22.218+02"), not the "...T...Z" ISO shape a caller
      // may have built staleBefore from, so lexicographic comparison would
      // be meaningless.
      return lastSyncedAt === null || new Date(lastSyncedAt).getTime() < staleBeforeMs;
    });

    if (stale.length === 0) {
      return [];
    }

    const userIds = [
      ...new Set(stale.map((row) => asString((row as Record<string, unknown>).userId))),
    ];
    const connections = await orm.BattleNetConnection
      .where((connection) => connection.userId.in(userIds))
      .all();

    const connectionByUserRegion = new Map<
      string,
      { id: string; userId: string; region: WowRegion }
    >();
    for (const row of connections) {
      const record = row as Record<string, unknown>;
      const userId = asString(record.userId);
      const region = mapRegion(record.region);
      connectionByUserRegion.set(`${userId}:${region}`, {
        id: asString(record.id),
        userId,
        region,
      });
    }

    const candidates: ScheduledCharacterSyncCandidate[] = [];
    for (const row of stale) {
      const record = row as Record<string, unknown>;
      const userId = asString(record.userId);
      const region = mapRegion(record.region);
      const connection = connectionByUserRegion.get(`${userId}:${region}`);
      if (!connection) continue;

      const user = (record.user ?? {}) as Record<string, unknown>;
      candidates.push({
        character: {
          id: asString(record.id),
          userId,
          name: asString(record.name),
          realm: asString(record.realm),
          region,
          normalizedName: asString(record.normalizedName),
          normalizedRealm: asString(record.normalizedRealm),
          wowClass: mapWowClass(record.wowClass),
          itemLevel: asNumberOrNull(record.itemLevel),
          blizzardCharacterId: asString(record.blizzardCharacterId),
          blizzardRealmId: asString(record.blizzardRealmId),
          lastSyncedAt: asStringOrNull(record.lastSyncedAt),
        },
        connection,
        owner: {
          id: userId,
          name: asString(user.name, "Unknown"),
        },
      });
    }

    return candidates;
  },
};
