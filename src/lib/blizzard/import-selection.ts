import { CLASS_LABELS } from "@/lib/labels";
import type { ImportCandidate, ImportCandidateStatus } from "@/lib/blizzard/types";

export function isEligibleImportStatus(status: ImportCandidateStatus): boolean {
  return status === "import" || status === "link";
}

export function importStatusLabel(status: ImportCandidateStatus): string {
  if (status === "import") return "Import";
  if (status === "link") return "Link existing";
  if (status === "already_linked") return "Already linked";
  return "Conflict";
}

export function filterImportCandidates(
  rows: ImportCandidate[],
  query: string,
): ImportCandidate[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (!needle) return rows;
  return rows.filter((row) => {
    const classLabel = CLASS_LABELS[row.wowClass]?.toLocaleLowerCase("en-US") ?? "";
    return (
      row.name.toLocaleLowerCase("en-US").includes(needle) ||
      row.realm.toLocaleLowerCase("en-US").includes(needle) ||
      classLabel.includes(needle) ||
      row.wowClass.toLocaleLowerCase("en-US").includes(needle)
    );
  });
}

export function eligibleCandidateIds(rows: ImportCandidate[]): string[] {
  return rows
    .filter((row) => isEligibleImportStatus(row.status))
    .map((row) => row.blizzardCharacterId);
}

export function needsSpecializationFallback(
  row: ImportCandidate,
  selected: boolean,
  suggestedSpecialization: string | null | undefined,
): boolean {
  return (
    selected &&
    row.status === "import" &&
    !suggestedSpecialization?.trim()
  );
}

export function selectionCountLabel(count: number): string {
  if (count === 1) return "1 selected";
  return `${count} selected`;
}

export function continueActionLabel(count: number): string {
  if (count === 0) return "Continue";
  if (count === 1) return "Continue with 1 character";
  return `Continue with ${count} characters`;
}
