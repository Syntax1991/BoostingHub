import type {
  BoosterAccessStatus,
  BoosterQualificationStatus,
  CharacterRole,
  RaidDifficulty,
  WowClass,
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
