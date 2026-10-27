import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  flush = false,
  borderless = false,
}: {
  children: ReactNode;
  className?: string;
  /** Drop default padding assumptions for nested dense content. */
  flush?: boolean;
  /** Soft surface without a heavy border (section-inside-workspace). */
  borderless?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-md bg-surface",
        !borderless && "border border-border",
        flush && "overflow-hidden",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Wraps: when the actions do not fit beside a readable title (12rem), they
        // move to their own row instead of squeezing the title into a sliver.
        "flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0 flex-[1_1_12rem]">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action ? <div className="max-w-full shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-0.5 max-w-2xl text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("px-3 py-4 text-center", className)}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
    </div>
  );
}
