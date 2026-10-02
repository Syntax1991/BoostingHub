import type { CharacterRole } from "@/models/enums";

export type CharacterRosterMetadataInput = {
  itemLevel: number | null;
  specialization: string | null;
  primaryRole: CharacterRole;
  /** Additional playable specs (never includes primary). */
  playableSpecs?: readonly string[];
};

function primarySpecLabel(input: CharacterRosterMetadataInput): string {
  return input.specialization ?? input.primaryRole;
}

/** Offspec names for display — excludes primary even if duplicated in input. */
export function additionalPlayableSpecLabels(input: CharacterRosterMetadataInput): string[] {
  const primaryKey = (input.specialization ?? "").trim().toLocaleLowerCase("en-US");
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of input.playableSpecs ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("en-US");
    if (primaryKey && key === primaryKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  return labels;
}

export function formatCharacterOffspecSuffix(offspecs: readonly string[]): string {
  if (offspecs.length === 0) return "";
  if (offspecs.length === 1) return ` · Offspec: ${offspecs[0]}`;
  return ` · Offspecs: ${offspecs.join(", ")}`;
}

/** Raid Lead roster/signup row metadata: ilvl · primary · optional offspecs. */
export function formatCharacterRosterMetadata(input: CharacterRosterMetadataInput): string {
  const ilvl = typeof input.itemLevel === "number" ? String(input.itemLevel) : "Unknown";
  const offspecs = additionalPlayableSpecLabels(input);
  return `${ilvl} ilvl · ${primarySpecLabel(input)}${formatCharacterOffspecSuffix(offspecs)}`;
}
