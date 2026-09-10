import { CLASS_LABELS } from "@/lib/labels";
import { Badge } from "@/components/ui/badges";
import { specializationsForClass } from "@/lib/wow-specializations";
import { MIN_IMPORT_CHARACTER_LEVEL } from "@/lib/blizzard/import-rules";
import {
  importStatusLabel,
  isSelectableImportCandidate,
  itemLevelSortAria,
  itemLevelSortLabel,
  resolvedSpecialization,
  type ItemLevelSortDirection,
} from "@/lib/blizzard/import-selection";
import type { ImportCandidate } from "@/lib/blizzard/types";

function statusBadgeClass(status: ImportCandidate["status"]): string {
  if (status === "import") return "bg-success/15 text-success";
  if (status === "link") return "bg-info/15 text-info";
  if (status === "already_linked") return "bg-surface-raised text-muted";
  if (status === "level_too_low") return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}

type RowControls = {
  row: ImportCandidate;
  pending: boolean;
  selected: boolean;
  enriching: boolean;
  suggested: string | null;
  blizzardItemLevel: number | null;
  specValue: string;
  onToggle: () => void;
  onSpecChange: (value: string) => void;
};

function ImportTableRow({
  row,
  pending,
  selected,
  enriching,
  suggested,
  blizzardItemLevel,
  specValue,
  onToggle,
  onSpecChange,
}: RowControls) {
  const selectable = isSelectableImportCandidate(row);
  const classSpecs = specializationsForClass(row.wowClass);
  const showControls = selected && selectable;
  const effectiveSpec = resolvedSpecialization(row, specValue, suggested);

  return (
    <tr
      className={`border-t border-border align-top ${selectable ? "" : "bg-surface-raised/40"}`}
    >
      <td className="px-2 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable || pending}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
      </td>
      <td className="px-2 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted">{row.realm}</div>
      </td>
      <td className="px-2 py-3">{CLASS_LABELS[row.wowClass]}</td>
      <td className="px-2 py-3">{row.level}</td>
      <td className="px-2 py-3">
        <Badge className={statusBadgeClass(row.status)}>{importStatusLabel(row.status)}</Badge>
        {row.conflictReason && row.status !== "level_too_low" ? (
          <p className="mt-1 text-xs text-muted">{row.conflictReason}</p>
        ) : null}
        {row.status === "level_too_low" ? (
          <p className="mt-1 text-xs text-muted">
            Discovered by Battle.net, but BoostingHub requires level {MIN_IMPORT_CHARACTER_LEVEL}+.
          </p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        {showControls ? (
          enriching && !effectiveSpec ? (
            <span className="text-xs text-muted">Loading…</span>
          ) : (
            <label className="block text-xs">
              <span className="sr-only">Specialization for {row.name}</span>
              <select
                value={effectiveSpec}
                disabled={pending}
                onChange={(event) => onSpecChange(event.target.value)}
                aria-label={`Specialization for ${row.name}`}
                className="h-8 w-full max-w-[12rem] rounded-md border border-border bg-surface px-2 text-sm"
              >
                <option value="">Select…</option>
                {classSpecs.map((spec) => (
                  <option key={spec.name} value={spec.name}>
                    {spec.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : enriching && !suggested ? (
          <span className="text-xs text-muted">Loading…</span>
        ) : selectable ? (
          <span className="text-xs text-muted">{suggested ?? "—"}</span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-2 py-3">
        {enriching && blizzardItemLevel == null ? (
          <span className="text-xs text-muted">Loading…</span>
        ) : typeof blizzardItemLevel === "number" ? (
          <div className="text-xs">
            <span className="font-medium">{blizzardItemLevel}</span>
            <span className="text-muted"> · Blizzard</span>
          </div>
        ) : (
          <span className="text-xs text-muted">Unknown</span>
        )}
      </td>
    </tr>
  );
}

export function BattleNetImportTable({
  rows,
  pending,
  selected,
  enriching,
  specs,
  itemLevelSort,
  suggestedFor,
  blizzardItemLevelFor,
  onToggle,
  onSpecChange,
  onCycleItemLevelSort,
}: {
  rows: ImportCandidate[];
  pending: boolean;
  selected: Record<string, boolean>;
  enriching: Record<string, boolean>;
  specs: Record<string, string>;
  itemLevelSort: ItemLevelSortDirection | null;
  suggestedFor: (row: ImportCandidate) => string | null;
  blizzardItemLevelFor: (row: ImportCandidate) => number | null;
  onToggle: (row: ImportCandidate) => void;
  onSpecChange: (blizzardCharacterId: string, value: string) => void;
  onCycleItemLevelSort: () => void;
}) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-2 py-2 font-medium">Select</th>
            <th className="px-2 py-2 font-medium">Character</th>
            <th className="px-2 py-2 font-medium">Class</th>
            <th className="px-2 py-2 font-medium">Level</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Specialization</th>
            <th className="px-2 py-2 font-medium" aria-sort={itemLevelSortAria(itemLevelSort)}>
              <button
                type="button"
                className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                onClick={onCycleItemLevelSort}
              >
                {itemLevelSortLabel(itemLevelSort)}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ImportTableRow
              key={row.blizzardCharacterId}
              row={row}
              pending={pending}
              selected={Boolean(selected[row.blizzardCharacterId])}
              enriching={Boolean(enriching[row.blizzardCharacterId])}
              suggested={suggestedFor(row)}
              blizzardItemLevel={blizzardItemLevelFor(row)}
              specValue={specs[row.blizzardCharacterId] ?? ""}
              onToggle={() => onToggle(row)}
              onSpecChange={(value) => onSpecChange(row.blizzardCharacterId, value)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
