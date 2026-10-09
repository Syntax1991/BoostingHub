import {
  CHARACTER_SYNC_ERROR_CODES,
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  BOOSTER_ACCESS_STATUSES,
  CHARACTER_ROLES,
  PARTICIPATION_TYPES,
  RAID_DIFFICULTIES,
  RUN_LOOT_TYPES,
  RUN_STATUSES,
  SIGNUP_STATUSES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  ROSTER_STATES,
  ATTENDANCE_STATUSES,
  STRIKE_STATUSES,
  INTEGRATION_PROVIDERS,
  INTEGRATION_EVENT_STATUSES,
  RUN_DOMAIN_EVENT_ACTOR_KINDS,
  WOW_CLASSES,
  WOW_REGIONS,
  type AccountRole,
  type CharacterSyncErrorCode,
  type AccountStatus,
  type AttendanceStatus,
  type BoosterAccessStatus,
  type StrikeStatus,
  type CharacterRole,
  type LootbuddyMode,
  type LootbuddyVerification,
  type ParticipationType,
  type RosterState,
  type RaidDifficulty,
  type RunLootType,
  type RunStatus,
  type SignupStatus,
  type WowClass,
  type WowRegion,
  type IntegrationProvider,
  type IntegrationEventStatus,
  type RunDomainEventActorKind,
} from "@/models/enums";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Normalize Prisma/Postgres timestamptz readbacks to canonical ISO-8601 UTC.
 * Prisma Next may return `"YYYY-MM-DD HH:MM:SS+00"`; domain code emits
 * `"YYYY-MM-DDTHH:MM:SS.000Z"`. Strict string equality between those forms
 * must not break Schedule link lookups.
 */
function asIsoTimestamp(value: unknown, fallback = ""): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Null for no error; an unknown stored value degrades to INTERNAL, never raw text. */
export function mapCharacterSyncErrorCode(value: unknown): CharacterSyncErrorCode | null {
  if (value == null) return null;
  return asEnum(value, CHARACTER_SYNC_ERROR_CODES, "INTERNAL");
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

export function mapLootType(value: unknown): RunLootType {
  return asEnum(value, RUN_LOOT_TYPES, "UNSAVED");
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

export function mapStrikeStatus(value: unknown): StrikeStatus {
  return asEnum(value, STRIKE_STATUSES, "ACTIVE");
}

export function mapIntegrationProvider(value: unknown): IntegrationProvider {
  return asEnum(value, INTEGRATION_PROVIDERS, "SYSTEM");
}

export function mapIntegrationEventStatus(value: unknown): IntegrationEventStatus {
  return asEnum(value, INTEGRATION_EVENT_STATUSES, "ERROR");
}

export function mapRunDomainEventActorKind(value: unknown): RunDomainEventActorKind {
  return asEnum(value, RUN_DOMAIN_EVENT_ACTOR_KINDS, "SYSTEM");
}

export function mapWowRegionOrNull(value: unknown): WowRegion | null {
  if (value == null) return null;
  return asEnum(value, WOW_REGIONS, "EU");
}

export {
  asBoolean,
  asIsoTimestamp,
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
};
