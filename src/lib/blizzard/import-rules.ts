import {
  CHARACTER_ITEM_LEVEL_MAX,
  CHARACTER_ITEM_LEVEL_MIN,
} from "@/lib/character-identity";
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

export function assertManualImportItemLevel(value: unknown, characterLabel: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DomainError(
      "INVALID_ITEM_LEVEL",
      `Enter an item level for ${characterLabel}.`,
    );
  }
  if (value < CHARACTER_ITEM_LEVEL_MIN) {
    throw new DomainError("INVALID_ITEM_LEVEL", `Item level for ${characterLabel} cannot be negative.`);
  }
  if (value > CHARACTER_ITEM_LEVEL_MAX) {
    throw new DomainError("INVALID_ITEM_LEVEL", `Item level for ${characterLabel} is too high.`);
  }
  return value;
}
