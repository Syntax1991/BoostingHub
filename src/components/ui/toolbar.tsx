import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Compact filter / search / primary-action bar.
 * Prefer one toolbar per page instead of scattered filters.
 */
export function Toolbar({
  children,
  className,
  end,
}: {
  children: ReactNode;
  className?: string;
  /** Primary action or sort/view controls aligned to the end. */
  end?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface px-2.5 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">{children}</div>
      {end ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{end}</div> : null}
    </div>
  );
}

export function ToolbarField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid min-w-[7rem] flex-1 gap-0.5 text-[11px] sm:max-w-[12rem]", className)}>
      <span className="font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Shared control look for toolbar inputs/selects. */
export const toolbarControlClassName =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground";
