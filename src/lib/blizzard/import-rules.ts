import { DomainError } from "@/lib/errors";

/** Minimum WoW character level required for Battle.net import / link. */
export const MIN_IMPORT_CHARACTER_LEVEL = 90;

export function meetsImportCharacterLevel(level: number): boolean {
  return Number.isFinite(level) && level >= MIN_IMPORT_CHARACTER_LEVEL;
}

export function assertImportCharacterLevel(level: number, characterLabel: string): void {
  if (meetsImportCharacterLevel(level)) return;
  throw new DomainError(
    "BLIZZARD_LEVEL_TOO_LOW",
    `${characterLabel} cannot be imported because level ${MIN_IMPORT_CHARACTER_LEVEL} is required.`,
  );
}
