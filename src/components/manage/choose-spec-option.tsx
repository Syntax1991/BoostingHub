"use client";

import { SpecIcon } from "@/components/ui/spec-icon";
import { RoleIcon } from "@/components/ui/ops-icons";
import { WclBestLink } from "@/components/ui/wcl-best-link";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { OfferedSpecChoice } from "@/lib/signup-offered-specs";
import {
  formatWclSpecTooltip,
  wclAvgForSpec,
  wclBestForSpec,
} from "@/lib/wcl-spec-performance";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";
import type { WowClass } from "@/models/enums";

/**
 * One Choose-spec modal row: select button + separate WCL Best link.
 * The link must never select the spec or close the dialog.
 */
export function ChooseSpecOption({
  choice,
  characterLabel,
  wowClass,
  warcraftLogsId,
  wclSegments,
  isCurrent,
  onSelect,
}: {
  choice: OfferedSpecChoice;
  characterLabel: string;
  wowClass: WowClass | null;
  warcraftLogsId: string | null | undefined;
  wclSegments: WclPerformanceRaidSegment[];
  isCurrent: boolean;
  onSelect: (choice: OfferedSpecChoice) => void;
}) {
  const best = wclBestForSpec(wclSegments, choice.role, choice.name);
  const avg = wclAvgForSpec(wclSegments, choice.role, choice.name);
  const tooltip =
    best != null ? formatWclSpecTooltip(wclSegments, choice.role, choice.name) : null;

  return (
    <div
      role="option"
      aria-selected={isCurrent}
      className={`flex min-h-11 w-full items-stretch overflow-hidden rounded-md border ${
        isCurrent
          ? "border-success/60 bg-success/10 text-foreground"
          : "border-border bg-surface-raised/40"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        onClick={() => onSelect(choice)}
      >
        {wowClass ? (
          <SpecIcon wowClass={wowClass} specialization={choice.name} size={28} />
        ) : (
          <RoleIcon role={choice.role} size={22} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{choice.name}</span>
          <span className="block text-xs text-muted">{CHARACTER_ROLE_LABELS[choice.role]}</span>
        </span>
        {isCurrent ? <span className="text-xs font-normal text-success">Current</span> : null}
      </button>
      <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 border-l border-border/60 px-2 py-1.5 sm:px-3">
        {typeof best === "number" ? (
          <WclBestLink
            bestPct={best}
            warcraftLogsId={warcraftLogsId}
            tooltip={tooltip}
            labelPrefix="Best "
            accessibleName={`Open ${characterLabel} ${choice.name} on Warcraft Logs`}
            className="min-h-9 min-w-[3.25rem] justify-end px-1.5 text-sm"
          />
        ) : null}
        {avg != null ? (
          <span className="px-1.5 text-xs tabular-nums text-muted">
            Avg {Number.isInteger(avg) ? avg : avg.toFixed(0)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
