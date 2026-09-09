/**
 * Owner-scoped character identity is region + realm + name.
 * Display values keep the operator's spelling; duplicates compare these
 * canonical tokens so "Synblast" / "synblast" cannot be stored twice.
 *
 * Diacritics are kept. Éowyn and Eowyn are different characters.
 */
export function normalizeCharacterIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export const CHARACTER_NAME_MIN = 2;
export const CHARACTER_NAME_MAX = 16;
export const CHARACTER_REALM_MIN = 2;
export const CHARACTER_REALM_MAX = 64;
export const CHARACTER_ITEM_LEVEL_MIN = 0;
export const CHARACTER_ITEM_LEVEL_MAX = 9999;

const NAME_PATTERN = /^[\p{L}][\p{L}'’-]*$/u;
const REALM_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '’-]*[\p{L}\p{N}]$/u;

export function prepareCharacterName(value: string): string {
  return value.normalize("NFKC").trim();
}

export function prepareRealmName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function isValidCharacterName(value: string): boolean {
  return (
    value.length >= CHARACTER_NAME_MIN &&
    value.length <= CHARACTER_NAME_MAX &&
    NAME_PATTERN.test(value)
  );
}

export function isValidRealmName(value: string): boolean {
  return (
    value.length >= CHARACTER_REALM_MIN &&
    value.length <= CHARACTER_REALM_MAX &&
    REALM_PATTERN.test(value)
  );
}
