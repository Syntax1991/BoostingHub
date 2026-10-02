import type { CharacterRole, WowClass } from "@/models/enums";
import { WOW_SPECIALIZATIONS } from "@/lib/wow-specializations";

/** Shared display input for primary + additional playable specs. */
export type CharacterPlayableSpecInput = {
  specialization: string | null;
  wowClass?: WowClass | null;
  /** Additional playable specs. Primary is omitted even if a stale row repeats it. */
  playableSpecs?: readonly string[];
};

export type CharacterRosterMetadataInput = CharacterPlayableSpecInput & {
  itemLevel: number | null;
  primaryRole: CharacterRole;
};

function primarySpecLabel(input: CharacterRosterMetadataInput): string {
  return input.specialization?.trim() || input.primaryRole;
}

function specKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function catalogIndex(wowClass: WowClass | null | undefined, spec: string): number {
  if (!wowClass) return Number.MAX_SAFE_INTEGER;
  const index = WOW_SPECIALIZATIONS[wowClass].findIndex((entry) => specKey(entry.name) === specKey(spec));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Additional playable spec names for the roster metadata line.
 * Display only: does not change offered roles, assignment, or stored rows.
 * Catalog order when the class is known; unknown names stay after those, sorted.
 */
export function additionalPlayableSpecLabels(input: CharacterPlayableSpecInput): string[] {
  const primaryKey = specKey(input.specialization ?? "");
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of input.playableSpecs ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = specKey(trimmed);
    if (primaryKey && key === primaryKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  labels.sort((left, right) => {
    const order = catalogIndex(input.wowClass, left) - catalogIndex(input.wowClass, right);
    if (order !== 0) return order;
    return left.localeCompare(right, "en-US");
  });
  return labels;
}

export function formatCharacterOffspecSuffix(offspecs: readonly string[]): string {
  if (offspecs.length === 0) return "";
  if (offspecs.length === 1) return ` · Offspec: ${offspecs[0]}`;
  return ` · Offspecs: ${offspecs.join(", ")}`;
}

/**
 * Character page spec line: primary, then Offspec / Offspecs when configured.
 * Missing primary stays "No spec". Does not fall back to the role label.
 */
export function formatCharacterPageSpecLine(input: CharacterPlayableSpecInput): string {
  const primary = input.specialization?.trim() || "No spec";
  return `${primary}${formatCharacterOffspecSuffix(additionalPlayableSpecLabels(input))}`;
}

/** Raid Lead roster card metadata: ilvl · primary · optional offspecs. */
export function formatCharacterRosterMetadata(input: CharacterRosterMetadataInput): string {
  const ilvl = typeof input.itemLevel === "number" ? String(input.itemLevel) : "Unknown";
  return `${ilvl} ilvl · ${primarySpecLabel(input)}${formatCharacterOffspecSuffix(additionalPlayableSpecLabels(input))}`;
}
