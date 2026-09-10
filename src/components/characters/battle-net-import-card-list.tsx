import { CLASS_LABELS } from "@/lib/labels";
import { Badge } from "@/components/ui/badges";
import { specializationsForClass } from "@/lib/wow-specializations";
import { MIN_IMPORT_CHARACTER_LEVEL } from "@/lib/blizzard/import-rules";
import {
  importStatusLabel,
  isSelectableImportCandidate,
  resolvedSpecialization,
} from "@/lib/blizzard/import-selection";
import type { ImportCandidate } from "@/lib/blizzard/types";

function statusBadgeClass(status: ImportCandidate["status"]): string {
  if (status === "import") return "bg-success/15 text-success";
  if (status === "link") return "bg-info/15 text-info";
  if (status === "already_linked") return "bg-surface-raised text-muted";
  if (status === "level_too_low") return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}

type CardControls = {
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

function ImportMobileCard({
  row,
  pending,
  selected,
  enriching,
  suggested,
  blizzardItemLevel,
  specValue,
  onToggle,
  onSpecChange,
}: CardControls) {
  const selectable = isSelectableImportCandidate(row);
  const classSpecs = specializationsForClass(row.wowClass);
  const showControls = selected && selectable;
  const effectiveSpec = resolvedSpecialization(row, specValue, suggested);

  return (
    <div
      className={`rounded-md border border-border px-3 py-3 ${selectable ? "" : "bg-surface-raised/40"}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected}
          disabled={!selectable || pending}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted">
            {row.realm} · {CLASS_LABELS[row.wowClass]} · Level {row.level}
          </div>
          <div className="mt-2">
            <Badge className={statusBadgeClass(row.status)}>{importStatusLabel(row.status)}</Badge>
          </div>
          {row.status === "level_too_low" ? (
            <p className="mt-2 text-xs text-muted">
              Requires level {MIN_IMPORT_CHARACTER_LEVEL}.
            </p>
          ) : null}
          {selectable ? (
            <div className="mt-3 space-y-2">
              {showControls ? (
                <label className="block text-xs">
                  <span className="mb-1 block text-muted">Specialization</span>
                  <select
                    value={effectiveSpec}
                    disabled={pending || (enriching && !effectiveSpec)}
                    onChange={(event) => onSpecChange(event.target.value)}
                    className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {classSpecs.map((spec) => (
                      <option key={spec.name} value={spec.name}>
                        {spec.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="text-xs">
                  <span className="mb-1 block text-muted">Specialization</span>
                  {enriching && !suggested ? (
                    <span className="text-muted">Loading…</span>
                  ) : (
                    <span>{suggested ?? "—"}</span>
                  )}
                </div>
              )}
              <div className="text-xs">
                <span className="mb-1 block text-muted">Item Level</span>
                {typeof blizzardItemLevel === "number" ? (
                  <span>{blizzardItemLevel} · Blizzard</span>
                ) : enriching ? (
                  <span className="text-muted">Loading…</span>
                ) : (
                  <span className="text-muted">Unknown</span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function BattleNetImportCardList({
  rows,
  pending,
  selected,
  enriching,
  specs,
  suggestedFor,
  blizzardItemLevelFor,
  onToggle,
  onSpecChange,
}: {
  rows: ImportCandidate[];
  pending: boolean;
  selected: Record<string, boolean>;
  enriching: Record<string, boolean>;
  specs: Record<string, string>;
  suggestedFor: (row: ImportCandidate) => string | null;
  blizzardItemLevelFor: (row: ImportCandidate) => number | null;
  onToggle: (row: ImportCandidate) => void;
  onSpecChange: (blizzardCharacterId: string, value: string) => void;
}) {
  return (
    <div className="space-y-3 md:hidden">
      {rows.map((row) => (
        <ImportMobileCard
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
    </div>
  );
}
