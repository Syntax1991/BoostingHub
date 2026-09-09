import type {
  AccountRole,
  BoosterAccessStatus,
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

export const ROLE_LABELS: Record<AccountRole, string> = {
  USER: "User",
  RAID_LEAD: "Raid Lead",
  ADMIN: "Admin",
};

export const CLASS_LABELS: Record<WowClass, string> = {
  DEATH_KNIGHT: "Death Knight",
  DEMON_HUNTER: "Demon Hunter",
  DRUID: "Druid",
  EVOKER: "Evoker",
  HUNTER: "Hunter",
  MAGE: "Mage",
  MONK: "Monk",
  PALADIN: "Paladin",
  PRIEST: "Priest",
  ROGUE: "Rogue",
  SHAMAN: "Shaman",
  WARLOCK: "Warlock",
  WARRIOR: "Warrior",
};

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  TANK: "Tank",
  HEALER: "Healer",
  DPS: "DPS",
};

export const REGION_LABELS: Record<WowRegion, string> = {
  EU: "EU",
  US: "US",
};

export const DIFFICULTY_LABELS: Record<RaidDifficulty, string> = {
  NORMAL: "Normal",
  HEROIC: "Heroic",
  MYTHIC: "Mythic",
};

export const ACCESS_STATUS_LABELS: Record<BoosterAccessStatus, string> = {
  PENDING: "Pending Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REVOKED: "Revoked",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ROSTERING: "Rostering",
  PUBLISHED: "Published",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SIGNUP_STATUS_LABELS: Record<SignupStatus, string> = {
  PENDING: "Pending",
  SELECTED: "Selected",
  NOT_SELECTED: "Not Selected",
  WITHDRAWN: "Withdrawn",
};

export const PARTICIPATION_LABELS: Record<ParticipationType, string> = {
  BOOSTER: "Booster",
  LOOTBUDDY: "Lootbuddy",
};

export const LOOTBUDDY_MODE_LABELS: Record<LootbuddyMode, string> = {
  LOOT_ONLY: "Loot only",
  PLAYING: "Will be playing",
};

export const LOOTBUDDY_VERIFICATION_LABELS: Record<LootbuddyVerification, string> = {
  NONE: "None",
  ACCESS: "Access",
  TRIAL: "Trial",
};

export const CLASS_COLORS: Record<WowClass, string> = {
  DEATH_KNIGHT: "#C41E3A",
  DEMON_HUNTER: "#A330C9",
  DRUID: "#FF7C0A",
  EVOKER: "#33937F",
  HUNTER: "#AAD372",
  MAGE: "#3FC7EB",
  MONK: "#00FF98",
  PALADIN: "#F48CBA",
  PRIEST: "#FFFFFF",
  ROGUE: "#FFF468",
  SHAMAN: "#0070DD",
  WARLOCK: "#8788EE",
  WARRIOR: "#C69B6D",
};
