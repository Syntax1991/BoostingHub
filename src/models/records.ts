import type {
  BoosterAccessStatus,
  CharacterRole,
  CharacterSyncErrorCode,
  RaidDifficulty,
  WowClass,
  WowRegion,
} from "@/models/enums";

/** Legacy historical BoosterAccess request/history row. */
export type BoosterAccessRecord = {
  id: string;
  userId: string;
  characterId: string | null;
  wowClass: WowClass;
  role: CharacterRole;
  difficulty: RaidDifficulty;
  status: BoosterAccessStatus;
  notes: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A User's Boosting Roles — operational participation, independent of
 * accountRole (authorization). Booster is account-level and never scoped by
 * raid difficulty. See User.isBooster / User.isLootbuddy.
 */
export type BoostingRoles = {
  isBooster: boolean;
  isLootbuddy: boolean;
};

/**
 * A Character already reserved — draft-selected into another Run's roster, or
 * SELECTED there — on a different Run scheduled at the exact same time. A
 * cross-Run scheduling conflict, distinct from a raid lockout.
 */
export type CharacterRunReservationConflict = {
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
};

/**
 * Informational verified lockout context for the target Run's own
 * raid/difficulty and the Character's regional WoW reset containing
 * `scheduledStartAt` — including verified 0/x. Null means unknown/unverified.
 * Never a blocker. A Raid Lead decides operationally whether to use an
 * already-saved Character; the server never rejects a signup, offer, roster
 * selection, or publish because of this.
 */
export type SignupRaidSaveInfo = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  bossesDefeated: number;
  totalBossCount: number;
  isComplete: boolean;
  /** Catalog boss ids killed this reset; null/absent when unknown (older sync). */
  killedBossIds?: string[] | null;
};

/**
 * One globally-eligible row for the scheduled Blizzard character sync job:
 * an active, Blizzard-linked Character whose owner has a BattleNetConnection
 * for that Character's own region. Staleness is filtered before this shape
 * is built (see characterRepository.listScheduledSyncCandidates).
 */
export type ScheduledCharacterSyncCandidate = {
  character: {
    id: string;
    userId: string;
    name: string;
    realm: string;
    region: WowRegion;
    normalizedName: string;
    normalizedRealm: string;
    wowClass: WowClass;
    itemLevel: number | null;
    blizzardCharacterId: string | null;
    blizzardRealmId: string | null;
    lastSyncedAt: string | null;
    /** Failure telemetry for the scheduler-only backoff (lib/blizzard/sync-backoff.ts). */
    lastSyncAttemptAt: string | null;
    lastSyncErrorCode: CharacterSyncErrorCode | null;
    syncFailureCount: number;
  };
  /** The owner's regional connection when the Character is VERIFIED-linked; null → PUBLIC sync. */
  connection: {
    id: string;
    userId: string;
    region: WowRegion;
  } | null;
  owner: {
    id: string;
    name: string;
  };
};
