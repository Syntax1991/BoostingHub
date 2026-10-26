"use client";

import { getWarcraftLogsCharacterUrl } from "@/lib/warcraft-logs";
import { formatWclSpecChip } from "@/lib/wcl-spec-performance";
import { cn } from "@/lib/cn";

/**
 * Compact Best Perf. Avg as the Warcraft Logs character-profile link.
 * Click must not bubble into Signup tile draft selection / Choose Spec.
 */
export function WclBestLink({
  bestPct,
  warcraftLogsId,
  tooltip,
  accessibleName,
  className,
  /** Optional visible prefix (e.g. "Best Perf. Avg " in the Choose Spec modal). */
  labelPrefix = "",
}: {
  bestPct: number;
  warcraftLogsId: string | null | undefined;
  tooltip: string | null;
  accessibleName: string;
  className?: string;
  labelPrefix?: string;
}) {
  const chip = formatWclSpecChip(bestPct);
  if (!chip) return null;
  const url = getWarcraftLogsCharacterUrl(warcraftLogsId);
  if (!url) {
    // Percentile only — never a dead / placeholder WCL link.
    return (
      <span
        className={cn("shrink-0 tabular-nums font-semibold", className)}
        style={{ color: chip.color }}
        title={tooltip ?? undefined}
      >
        {labelPrefix}
        {chip.text}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip ?? undefined}
      aria-label={accessibleName}
      className={cn(
        "inline-flex shrink-0 items-center tabular-nums font-semibold hover:underline",
        className,
      )}
      style={{ color: chip.color }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        // Keep parent select-handlers (button / option row) from firing first.
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      {labelPrefix}
      {chip.text}
      <span aria-hidden className="ml-0.5 text-[10px] font-normal opacity-70">
        ↗
      </span>
    </a>
  );
}
