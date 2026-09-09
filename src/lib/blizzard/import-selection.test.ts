import { describe, expect, it } from "vitest";
import type { ImportCandidate } from "@/lib/blizzard/types";
import {
  continueActionLabel,
  eligibleCandidateIds,
  filterImportCandidates,
  importStatusLabel,
  isEligibleImportStatus,
  isSelectableImportCandidate,
  needsManualItemLevel,
  resolvedSpecialization,
  selectionCountLabel,
} from "@/lib/blizzard/import-selection";
import {
  assertImportCharacterLevel,
  meetsImportCharacterLevel,
  MIN_IMPORT_CHARACTER_LEVEL,
} from "@/lib/blizzard/import-rules";
import { isDomainError } from "@/lib/errors";

function candidate(
  partial: Partial<ImportCandidate> & Pick<ImportCandidate, "status" | "name">,
): ImportCandidate {
  return {
    blizzardCharacterId: partial.blizzardCharacterId ?? partial.name,
    name: partial.name,
    realm: partial.realm ?? "Antonidas",
    realmSlug: partial.realmSlug ?? "antonidas",
    realmId: partial.realmId ?? "1",
    region: partial.region ?? "EU",
    wowClass: partial.wowClass ?? "PALADIN",
    level: partial.level ?? MIN_IMPORT_CHARACTER_LEVEL,
    status: partial.status,
    characterId: partial.characterId ?? null,
    conflictReason: partial.conflictReason ?? null,
    suggestedSpecialization: partial.suggestedSpecialization ?? null,
    suggestedItemLevel: partial.suggestedItemLevel ?? null,
  };
}

describe("import-rules", () => {
  it("requires level 90+", () => {
    expect(meetsImportCharacterLevel(89)).toBe(false);
    expect(meetsImportCharacterLevel(90)).toBe(true);
    expect(meetsImportCharacterLevel(91)).toBe(true);
    expect(MIN_IMPORT_CHARACTER_LEVEL).toBe(90);
  });

  it("throws BLIZZARD_LEVEL_TOO_LOW below the minimum", () => {
    try {
      assertImportCharacterLevel(70, "Synbank");
      throw new Error("expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("BLIZZARD_LEVEL_TOO_LOW");
    }
  });
});

describe("import-selection helpers", () => {
  const rows = [
    candidate({ name: "Synlight", status: "import", wowClass: "PALADIN", level: 90 }),
    candidate({
      name: "Synblast",
      status: "link",
      wowClass: "SHAMAN",
      realm: "Blackrock",
      level: 91,
    }),
    candidate({ name: "Synbank", status: "level_too_low", wowClass: "WARRIOR", level: 10 }),
    candidate({ name: "LinkedOne", status: "already_linked", wowClass: "MAGE", level: 90 }),
    candidate({
      name: "ConflictOne",
      status: "conflict",
      wowClass: "WARRIOR",
      level: 90,
      conflictReason: "class mismatch",
    }),
  ];

  it("marks only import and link as eligible statuses", () => {
    expect(isEligibleImportStatus("import")).toBe(true);
    expect(isEligibleImportStatus("link")).toBe(true);
    expect(isEligibleImportStatus("already_linked")).toBe(false);
    expect(isEligibleImportStatus("conflict")).toBe(false);
    expect(isEligibleImportStatus("level_too_low")).toBe(false);
  });

  it("Select all eligible excludes level <90 and blocked states", () => {
    expect(eligibleCandidateIds(rows)).toEqual(["Synlight", "Synblast"]);
    expect(isSelectableImportCandidate(rows[2]!)).toBe(false);
  });

  it("filters by name, realm, and class", () => {
    expect(filterImportCandidates(rows, "syn")).toHaveLength(3);
    expect(filterImportCandidates(rows, "blackrock").map((row) => row.name)).toEqual(["Synblast"]);
    expect(filterImportCandidates(rows, "paladin").map((row) => row.name)).toEqual(["Synlight"]);
  });

  it("prefers user specialization over suggestion", () => {
    const row = rows[0]!;
    expect(resolvedSpecialization(row, "Retribution", "Holy")).toBe("Retribution");
    expect(resolvedSpecialization(row, "", "Holy")).toBe("Holy");
    expect(resolvedSpecialization(row, undefined, null)).toBe("");
  });

  it("requires manual item level only when Blizzard value is missing", () => {
    expect(needsManualItemLevel(true, 318)).toBe(false);
    expect(needsManualItemLevel(true, null)).toBe(true);
    expect(needsManualItemLevel(false, null)).toBe(false);
  });

  it("formats status and selection labels", () => {
    expect(importStatusLabel("link")).toBe("Link existing");
    expect(importStatusLabel("level_too_low")).toBe("Requires level 90");
    expect(selectionCountLabel(0)).toBe("0 selected");
    expect(continueActionLabel(5)).toBe("Continue with 5 characters");
  });
});
