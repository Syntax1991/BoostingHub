import type { CharacterRole, WowClass } from "@/models/enums";
import { CHARACTER_ROLES, WOW_CLASSES } from "@/models/enums";
import { asString, mapCharacterRole, mapWowClass } from "@/lib/persistence";
import { isRoleValidForClass } from "@/lib/wow-specializations";

/**
 * A booster the Raid Lead adds to a roster by hand because they are not
 * registered on the website (in-house helpers). Saved with the roster draft;
 * rendered as `@name <class>` in Discord.
 */
export type ExternalBooster = {
  id: string;
  name: string;
  wowClass: WowClass;
  role: CharacterRole;
};

/** What the Roster builder submits — ids are server-assigned on save. */
export type ExternalBoosterInput = {
  name: string;
  wowClass: WowClass;
  role: CharacterRole;
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
  if (!(CHARACTER_ROLES as readonly string[]).includes(input.role)) return "External booster needs a role.";
  if (!isRoleValidForClass(input.wowClass, input.role)) {
    return `${name} cannot play that role on this class.`;
  }
  return null;
}

/** Maps persisted RunExternalBooster rows, oldest first (the order they were listed in). */
export function mapExternalBoosters(value: unknown): ExternalBooster[] {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  return [...rows]
    .sort(
      (a, b) =>
        asString(a.createdAt).localeCompare(asString(b.createdAt)) || asString(a.id).localeCompare(asString(b.id)),
    )
    .map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      wowClass: mapWowClass(row.wowClass),
      role: mapCharacterRole(row.role),
    }));
}
