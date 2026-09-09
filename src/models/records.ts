import type {
  BoosterAccessStatus,
  CharacterRole,
  RaidDifficulty,
  WowClass,
} from "@/models/enums";

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

/** Enough for eligibility matching. Management UIs use the full record. */
export type BoosterAccessMatch = Pick<BoosterAccessRecord, "wowClass" | "role" | "difficulty" | "status">;
