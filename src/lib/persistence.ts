import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  BOOSTER_ACCESS_STATUSES,
  CHARACTER_ROLES,
  PARTICIPATION_TYPES,
  RAID_DIFFICULTIES,
  RUN_STATUSES,
  SIGNUP_STATUSES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  ROSTER_STATES,
  ATTENDANCE_STATUSES,
  WOW_CLASSES,
  WOW_REGIONS,
  type AccountRole,
  type AccountStatus,
  type AttendanceStatus,
  type BoosterAccessStatus,
  type CharacterRole,
  type LootbuddyMode,
  type LootbuddyVerification,
  type ParticipationType,
  type RosterState,
  type RaidDifficulty,
  type RunStatus,
  type SignupStatus,
  type WowClass,
  type WowRegion,
} from "@/models/enums";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function mapUserRole(value: unknown): AccountRole {
  return asEnum(value, ACCOUNT_ROLES, "USER");
}

export function mapAccountStatus(value: unknown): AccountStatus {
  return asEnum(value, ACCOUNT_STATUSES, "ACTIVE");
}

export function mapWowClass(value: unknown): WowClass {
  return asEnum(value, WOW_CLASSES, "WARRIOR");
}

export function mapCharacterRole(value: unknown): CharacterRole {
  return asEnum(value, CHARACTER_ROLES, "DPS");
}

export function mapRegion(value: unknown): WowRegion {
  return asEnum(value, WOW_REGIONS, "EU");
}

export function mapDifficulty(value: unknown): RaidDifficulty {
  return asEnum(value, RAID_DIFFICULTIES, "NORMAL");
}

export function mapAccessStatus(value: unknown): BoosterAccessStatus {
  return asEnum(value, BOOSTER_ACCESS_STATUSES, "PENDING");
}

export function mapRunStatus(value: unknown): RunStatus {
  return asEnum(value, RUN_STATUSES, "DRAFT");
}

export function mapSignupStatus(value: unknown): SignupStatus {
  return asEnum(value, SIGNUP_STATUSES, "PENDING");
}

export function mapParticipation(value: unknown): ParticipationType {
  return asEnum(value, PARTICIPATION_TYPES, "BOOSTER");
}

export function mapLootbuddyMode(value: unknown): LootbuddyMode {
  return asEnum(value, LOOTBUDDY_MODES, "LOOT_ONLY");
}

export function mapLootbuddyVerification(value: unknown): LootbuddyVerification {
  return asEnum(value, LOOTBUDDY_VERIFICATIONS, "NONE");
}

export function mapRosterState(value: unknown): RosterState {
  return asEnum(value, ROSTER_STATES, "DRAFT");
}

export function mapAttendanceStatus(value: unknown): AttendanceStatus {
  return asEnum(value, ATTENDANCE_STATUSES, "UNMARKED");
}

export {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
};
