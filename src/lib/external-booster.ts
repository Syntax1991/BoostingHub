import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";
import { CHARACTER_ROLES, WOW_CLASSES } from "@/models/enums";
import { asString, mapCharacterRole, mapParticipation, mapWowClass } from "@/lib/persistence";
import { isRoleValidForClass } from "@/lib/wow-specializations";

/**
 * A booster or lootbuddy the Raid Lead adds to a roster by hand because they
 * are not registered on the website (in-house helpers). Rendered as
 * `@name <class>` in Discord. A BOOSTER fills a Tank/Healer/DPS slot (role
 * set); a LOOTBUDDY has a class but no role.
 */
export type ExternalBooster = {
  id: string;
  name: string;
  wowClass: WowClass;
  participationType: ParticipationType;
  /** Always set for BOOSTER; null for LOOTBUDDY. */
  role: CharacterRole | null;
};

/** What the External Boosters dialog submits — ids are server-assigned on save. */
export type ExternalBoosterInput = {
  name: string;
  wowClass: WowClass;
  /** Omitted by older clients → BOOSTER. */
  participationType?: ParticipationType;
  role: CharacterRole | null;
};

export const EXTERNAL_BOOSTER_NAME_MAX_LENGTH = 32;
export const EXTERNAL_BOOSTERS_MAX_PER_ROSTER = 40;

/**
 * Letters, digits, space, dot, underscore and hyphen — enough for Discord
 * usernames and Character names, and nothing Discord treats as markdown or
 * mention syntax (`<`, `>`, `*`, `` ` ``, `|`, `#`, `@` …).
 */
const EXTERNAL_BOOSTER_NAME_PATTERN = /^[\p{L}\p{N} ._-]+$/u;
/** Would turn `@name` into a mass mention if Discord ever parsed it. */
const RESERVED_NAMES = new Set(["everyone", "here"]);

/** Trims, strips a leading `@` and collapses whitespace. */
export function normalizeExternalBoosterName(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, " ").trim();
}

/** Null when valid; otherwise a human-readable reason. */
export function externalBoosterInputError(input: ExternalBoosterInput): string | null {
  const name = normalizeExternalBoosterName(input.name);
  if (name.length === 0) return "External booster needs a name.";
  if (name.length > EXTERNAL_BOOSTER_NAME_MAX_LENGTH) {
    return `External booster names can be at most ${EXTERNAL_BOOSTER_NAME_MAX_LENGTH} characters.`;
  }
  if (!EXTERNAL_BOOSTER_NAME_PATTERN.test(name) || RESERVED_NAMES.has(name.toLowerCase())) {
    return `"${name}" is not a valid external booster name (letters, numbers, space, . _ - only).`;
  }
  if (!(WOW_CLASSES as readonly string[]).includes(input.wowClass)) return "External booster needs a class.";
  if ((input.participationType ?? "BOOSTER") === "LOOTBUDDY") {
    return null;
  }
  if (!input.role || !(CHARACTER_ROLES as readonly string[]).includes(input.role)) {
    return "External booster needs a role.";
  }
  if (!isRoleValidForClass(input.wowClass, input.role)) {
    return `${name} cannot play that role on this class.`;
  }
  return null;
}

/** Trimmed name, explicit participation type, and no role for a lootbuddy. Assumes a valid input. */
export function normalizeExternalBoosterInput(input: ExternalBoosterInput): Required<ExternalBoosterInput> {
  const participationType = input.participationType ?? "BOOSTER";
  return {
    name: normalizeExternalBoosterName(input.name),
    wowClass: input.wowClass,
    participationType,
    role: participationType === "LOOTBUDDY" ? null : input.role,
  };
}

/** Maps persisted RunExternalBooster rows, oldest first (the order they were listed in). */
export function mapExternalBoosters(value: unknown): ExternalBooster[] {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  return [...rows]
    .sort(
      (a, b) =>
        asString(a.createdAt).localeCompare(asString(b.createdAt)) || asString(a.id).localeCompare(asString(b.id)),
    )
    .map((row) => {
      const participationType = row.participationType == null ? "BOOSTER" : mapParticipation(row.participationType);
      return {
        id: asString(row.id),
        name: asString(row.name),
        wowClass: mapWowClass(row.wowClass),
        participationType,
        role: participationType === "LOOTBUDDY" || row.role == null ? null : mapCharacterRole(row.role),
      };
    });
}

/** External entries that fill a Tank/Healer/DPS slot. */
export function externalBoostersOnly(boosters: readonly ExternalBooster[]): Array<ExternalBooster & { role: CharacterRole }> {
  return boosters.filter(
    (booster): booster is ExternalBooster & { role: CharacterRole } =>
      booster.participationType === "BOOSTER" && booster.role != null,
  );
}

/** External lootbuddies (class only). */
export function externalLootbuddies(boosters: readonly ExternalBooster[]): ExternalBooster[] {
  return boosters.filter((booster) => booster.participationType === "LOOTBUDDY");
}
