import { orm } from "@/lib/prisma";
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
} from "@/lib/persistence";
import type { BoosterQualificationRecord, ScheduledCharacterSyncCandidate } from "@/models/records";
import type { CharacterRole, WowClass, WowRegion } from "@/models/enums";
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
  lastSyncedAt: string | null;
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
      itemLevel: input.itemLevel,
      isActive: input.isActive,
      blizzardCharacterId: input.blizzardCharacterId ?? null,
      blizzardRealmId: input.blizzardRealmId ?? null,
      lastSyncedAt: input.lastSyncedAt ?? null,
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
      ...(typeof input.itemLevel === "number" ? { itemLevel: input.itemLevel } : {}),
      ...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
      updatedAt: new Date().toISOString(),
    });
  },

  async applyBlizzardSync(characterId: string, input: CharacterBlizzardSyncInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      name: input.name,
      normalizedName: input.normalizedName,
      ...(typeof input.itemLevel === "number" ? { itemLevel: input.itemLevel } : {}),
      lastSyncedAt: input.lastSyncedAt,
      updatedAt: new Date().toISOString(),
    });
  },

  async setActive(characterId: string, isActive: boolean): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      isActive,
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

    const stale = linked.filter((row) => {
      const record = row as Record<string, unknown>;
      const lastSyncedAt = asStringOrNull(record.lastSyncedAt);
      return lastSyncedAt === null || lastSyncedAt < input.staleBefore;
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
