import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  RAID_ID_FILTER_LABELS,
  RAID_ID_FILTERS,
  type RaidIdFilter as RaidIdFilterValue,
} from "@/lib/raid-id-filter";

/**
 * Compact Current ID | Next ID | All segmented control (raid-ID week, `?id=`).
 * Each option is a real link, so refresh, back / forward and deep links keep it.
 */
export function RaidIdFilter({
  value,
  hrefs,
  className,
}: {
  value: RaidIdFilterValue;
  hrefs: Record<RaidIdFilterValue, string>;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Raid ID"
      className={cn(
        "inline-flex shrink-0 rounded-md border border-border bg-surface-raised p-0.5",
        className,
      )}
    >
      {RAID_ID_FILTERS.map((filter) => {
        const selected = filter === value;
        return (
          <Link
            key={filter}
            href={hrefs[filter]}
            scroll={false}
            aria-current={selected ? "true" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center whitespace-nowrap rounded px-2.5 text-xs font-medium",
              selected
                ? "bg-surface text-foreground shadow-[inset_0_-2px_0_0_var(--accent)]"
                : "text-muted hover:text-foreground",
            )}
          >
            {RAID_ID_FILTER_LABELS[filter]}
          </Link>
        );
      })}
    </div>
  );
}
