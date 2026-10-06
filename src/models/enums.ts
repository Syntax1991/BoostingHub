/**
 * Domain enumerations used across Model, Service and View layers.
 * Persistence CHECK constraints in the Prisma contract must stay in sync with these values.
 */

/** Every persisted account role (hierarchy: OWNER > ADMIN > RAID_LEAD > USER). */
export const ACCOUNT_ROLES = ["USER", "RAID_LEAD", "ADMIN", "OWNER"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * Roles the generic "Change role" flow may assign. OWNER is deliberately
 * absent: ownership is only ever set by the explicit owner bootstrap.
 */
export const MANAGEABLE_ACCOUNT_ROLES = ["USER", "RAID_LEAD", "ADMIN"] as const satisfies readonly AccountRole[];
export type ManageableAccountRole = (typeof MANAGEABLE_ACCOUNT_ROLES)[number];

/**
 * Safe persisted category of a Character's latest failed Blizzard sync attempt
 * (Character.lastSyncErrorCode). Never raw upstream text.
 */
export const CHARACTER_SYNC_ERROR_CODES = [
  "PROFILE_UNAVAILABLE",
  "IDENTITY_CONFLICT",
  "NAME_CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "AUTH_OR_CONFIG",
  "INTERNAL",
] as const;
export type CharacterSyncErrorCode = (typeof CHARACTER_SYNC_ERROR_CODES)[number];

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

/**
 * Roster / signup roles. MELEE_DPS and RANGED_DPS are authoritative for new
 * writes. DPS is legacy-only (historic rows); never invent a subtype from it.
 */
export const CHARACTER_ROLES = ["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS", "DPS"] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export const WOW_REGIONS = ["EU", "US"] as const;
export type WowRegion = (typeof WOW_REGIONS)[number];

export const RAID_DIFFICULTIES = ["NORMAL", "HEROIC", "MYTHIC"] as const;
export type RaidDifficulty = (typeof RAID_DIFFICULTIES)[number];

/** Community Schedule recurring weekday (wall-clock intent, Europe/Berlin). */
export const COMMUNITY_WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type CommunityWeekday = (typeof COMMUNITY_WEEKDAYS)[number];

/**
 * Independent of RaidDifficulty. Compatibility (e.g. MYTHIC cannot be SAVED)
 * is a domain rule enforced in the Service layer — see run-state.ts.
 *
 * Persisted field remains `lootType` for backward compatibility; product UI
 * presents these as Run types (Saved / Unsaved / VIP / Community).
 */
export const RUN_LOOT_TYPES = ["SAVED", "UNSAVED", "VIP", "COMMUNITY"] as const;
export type RunLootType = (typeof RUN_LOOT_TYPES)[number];

export const BOOSTER_ACCESS_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;
export type BoosterAccessStatus = (typeof BOOSTER_ACCESS_STATUSES)[number];

/** The two independent Boosting Roles a User can hold. Never an accountRole. */
export const BOOSTING_ROLES = ["BOOSTER", "LOOTBUDDY"] as const;
export type BoostingRole = (typeof BOOSTING_ROLES)[number];

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

export const RAID_LEAD_CUT_MODES = ["KEEP", "SHARE"] as const;
export type RaidLeadCutMode = (typeof RAID_LEAD_CUT_MODES)[number];

/** No EXPIRED status: Strikes never expire automatically in this contract. */
export const STRIKE_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type StrikeStatus = (typeof STRIKE_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "ROSTER_SELECTED",
  "RAID_INVITE",
  "RUN_CANCELLED",
  "RUN_RESCHEDULED",
  "ROSTER_REMOVED",
  "ROSTER_WITHDRAWN",
  "RUN_REACTIVATED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DISCORD_DELIVERY_STATUSES = [
  "PENDING",
  "SENT",
  "SKIPPED",
  "FAILED_PERMANENT",
] as const;
export type DiscordDeliveryStatus = (typeof DISCORD_DELIVERY_STATUSES)[number];

/** Shared Run Discord channel lifecycle announcements (not User DMs). */
export const RUN_DISCORD_ANNOUNCEMENT_TYPES = ["RUN_RESCHEDULED", "RUN_CANCELLED", "RUN_REACTIVATED"] as const;

/** System Health / integration telemetry providers (IntegrationEvent.provider). */
export const INTEGRATION_PROVIDERS = [
  "BLIZZARD",
  "WARCRAFT_LOGS",
  "DISCORD",
  "RAIDER_IO",
  "SYSTEM",
  "BACKUP",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/** IntegrationEvent.status — WARNING is degraded-but-continuing. */
export const INTEGRATION_EVENT_STATUSES = ["SUCCESS", "WARNING", "ERROR"] as const;
export type IntegrationEventStatus = (typeof INTEGRATION_EVENT_STATUSES)[number];
export type RunDiscordAnnouncementType = (typeof RUN_DISCORD_ANNOUNCEMENT_TYPES)[number];

/** RunDomainEvent.actorKind — SYSTEM never fabricates a user actor. */
export const RUN_DOMAIN_EVENT_ACTOR_KINDS = ["USER", "SYSTEM"] as const;
export type RunDomainEventActorKind = (typeof RUN_DOMAIN_EVENT_ACTOR_KINDS)[number];

/** Stable RunDomainEvent.type keys for meaningful lifecycle events. */
export const RUN_DOMAIN_EVENT_TYPES = [
  "RUN_CREATED",
  "RUN_OPENED",
  "RUN_SCHEDULE_CHANGED",
  "RUN_CONTENT_CHANGED",
  "RUN_RAID_LEAD_CHANGED",
  "SIGNUPS_OPENED",
  "SIGNUPS_CLOSED",
  "ROSTER_PUBLISHED",
  "ROSTER_SELECTION_CHANGED",
  "EXTERNAL_BOOSTERS_UPDATED",
  "RUN_STARTED",
  "ATTENDANCE_CORRECTED",
  "RUN_COMPLETED",
  "RUN_CANCELLED",
  "RUN_REACTIVATED",
] as const;
export type RunDomainEventType = (typeof RUN_DOMAIN_EVENT_TYPES)[number];

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
