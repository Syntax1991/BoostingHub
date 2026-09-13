import type {
  BoosterAccessStatus,
  BoosterQualificationStatus,
  CharacterRole,
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
 * @deprecated Prefer BoosterQualificationMatch for current eligibility.
 * Kept for legacy request display only.
 */
export type BoosterAccessMatch = Pick<BoosterAccessRecord, "wowClass" | "role" | "difficulty" | "status">;

/** Authoritative current BoosterQualification: User + Difficulty. */
export type BoosterQualificationRecord = {
  id: string;
  userId: string;
  difficulty: RaidDifficulty;
  status: BoosterQualificationStatus;
  notes: string | null;
  grantedAt: string | null;
  grantedById: string | null;
  revokedAt: string | null;
  revokedById: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Enough for eligibility matching. */
export type BoosterQualificationMatch = Pick<BoosterQualificationRecord, "difficulty" | "status">;

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
    blizzardCharacterId: string;
    blizzardRealmId: string;
    lastSyncedAt: string | null;
  };
  connection: {
    id: string;
    userId: string;
    region: WowRegion;
  };
  owner: {
    id: string;
    name: string;
  };
};
