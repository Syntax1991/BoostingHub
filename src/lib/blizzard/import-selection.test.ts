import { describe, expect, it } from "vitest";
import type { ImportCandidate } from "@/lib/blizzard/types";
import {
  continueActionLabel,
  eligibleCandidateIds,
  filterImportCandidates,
  importStatusLabel,
  isEligibleImportStatus,
  needsSpecializationFallback,
  selectionCountLabel,
} from "@/lib/blizzard/import-selection";

function candidate(partial: Partial<ImportCandidate> & Pick<ImportCandidate, "status" | "name">): ImportCandidate {
  return {
    blizzardCharacterId: partial.blizzardCharacterId ?? partial.name,
    name: partial.name,
    realm: partial.realm ?? "Antonidas",
    realmSlug: partial.realmSlug ?? "antonidas",
    realmId: partial.realmId ?? "1",
    region: partial.region ?? "EU",
    wowClass: partial.wowClass ?? "PALADIN",
    level: partial.level ?? 80,
    status: partial.status,
    characterId: partial.characterId ?? null,
    conflictReason: partial.conflictReason ?? null,
    suggestedSpecialization: partial.suggestedSpecialization ?? null,
    suggestedItemLevel: partial.suggestedItemLevel ?? null,
  };
}

describe("import-selection helpers", () => {
  const rows = [
    candidate({ name: "Synlight", status: "import", wowClass: "PALADIN" }),
    candidate({ name: "Synblast", status: "link", wowClass: "SHAMAN", realm: "Blackrock" }),
    candidate({ name: "LinkedOne", status: "already_linked", wowClass: "MAGE" }),
    candidate({
      name: "ConflictOne",
      status: "conflict",
      wowClass: "WARRIOR",
      conflictReason: "class mismatch",
    }),
  ];

  it("marks only import and link as eligible", () => {
    expect(isEligibleImportStatus("import")).toBe(true);
    expect(isEligibleImportStatus("link")).toBe(true);
    expect(isEligibleImportStatus("already_linked")).toBe(false);
    expect(isEligibleImportStatus("conflict")).toBe(false);
    expect(eligibleCandidateIds(rows)).toEqual(["Synlight", "Synblast"]);
  });

  it("filters by name, realm, and class", () => {
    expect(filterImportCandidates(rows, "syn")).toHaveLength(2);
    expect(filterImportCandidates(rows, "blackrock").map((row) => row.name)).toEqual(["Synblast"]);
    expect(filterImportCandidates(rows, "paladin").map((row) => row.name)).toEqual(["Synlight"]);
  });

  it("requires specialization fallback only for selected unresolved imports", () => {
    const importRow = rows[0]!;
    expect(needsSpecializationFallback(importRow, false, null)).toBe(false);
    expect(needsSpecializationFallback(importRow, true, null)).toBe(true);
    expect(needsSpecializationFallback(importRow, true, "Holy")).toBe(false);
    expect(needsSpecializationFallback(rows[1]!, true, null)).toBe(false);
  });

  it("formats status and selection labels", () => {
    expect(importStatusLabel("link")).toBe("Link existing");
    expect(importStatusLabel("already_linked")).toBe("Already linked");
    expect(selectionCountLabel(0)).toBe("0 selected");
    expect(selectionCountLabel(1)).toBe("1 selected");
    expect(continueActionLabel(5)).toBe("Continue with 5 characters");
  });
});
