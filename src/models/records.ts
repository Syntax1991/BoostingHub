import type {
  BoosterAccessStatus,
  CharacterRole,
  RaidDifficulty,
  WowClass,
} from "@/models/enums";

export type BoosterAccessRecord = {
  wowClass: WowClass;
  role: CharacterRole;
  difficulty: RaidDifficulty;
  status: BoosterAccessStatus;
};
