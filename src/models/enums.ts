/**
 * Domain enumerations used across Model, Service and View layers.
 * Persistence CHECK constraints in the Prisma contract must stay in sync with these values.
 */

export const ACCOUNT_ROLES = ["USER", "RAID_LEAD", "ADMIN"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const WOW_CLASSES = [
  "DEATH_KNIGHT",
  "DEMON_HUNTER",
  "DRUID",
  "EVOKER",
  "HUNTER",
  "MAGE",
  "MONK",
  "PALADIN",
  "PRIEST",
  "ROGUE",
  "SHAMAN",
  "WARLOCK",
  "WARRIOR",
] as const;
export type WowClass = (typeof WOW_CLASSES)[number];

export const CHARACTER_ROLES = ["TANK", "HEALER", "DPS"] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export const WOW_REGIONS = ["EU", "US"] as const;
export type WowRegion = (typeof WOW_REGIONS)[number];

export const RAID_DIFFICULTIES = ["NORMAL", "HEROIC", "MYTHIC"] as const;
export type RaidDifficulty = (typeof RAID_DIFFICULTIES)[number];

export const BOOSTER_ACCESS_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;
export type BoosterAccessStatus = (typeof BOOSTER_ACCESS_STATUSES)[number];

export const RUN_STATUSES = [
  "DRAFT",
  "OPEN",
  "ROSTERING",
  "PUBLISHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const SIGNUP_STATUSES = ["PENDING", "SELECTED", "NOT_SELECTED", "WITHDRAWN"] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

export const PARTICIPATION_TYPES = ["BOOSTER", "LOOTBUDDY"] as const;
export type ParticipationType = (typeof PARTICIPATION_TYPES)[number];

export const LOOTBUDDY_MODES = ["LOOT_ONLY", "PLAYING"] as const;
export type LootbuddyMode = (typeof LOOTBUDDY_MODES)[number];

export const LOOTBUDDY_VERIFICATIONS = ["NONE", "ACCESS", "TRIAL"] as const;
export type LootbuddyVerification = (typeof LOOTBUDDY_VERIFICATIONS)[number];

export const ROSTER_STATES = ["DRAFT", "PUBLISHED"] as const;
export type RosterState = (typeof ROSTER_STATES)[number];

export const ATTENDANCE_STATUSES = [
  "UNMARKED",
  "PRESENT",
  "LATE",
  "LEFT_EARLY",
  "NO_SHOW",
  "EXCUSED",
  "STANDBY",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const SETTLEMENT_STATUSES = ["DRAFT", "FINALIZED", "PAID"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const MARKABLE_ATTENDANCE_STATUSES = ATTENDANCE_STATUSES.filter(
  (status) => status !== "UNMARKED",
) as readonly Exclude<AttendanceStatus, "UNMARKED">[];

/** Run statuses that still appear in operational "upcoming" lists. */
export const UPCOMING_RUN_STATUSES: readonly RunStatus[] = [
  "OPEN",
  "ROSTERING",
  "PUBLISHED",
  "IN_PROGRESS",
];

/** Signups that still represent an active relationship with a run. */
export const ACTIVE_SIGNUP_STATUSES: readonly SignupStatus[] = ["PENDING", "SELECTED"];
