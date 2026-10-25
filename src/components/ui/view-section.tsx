import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Compact section title used across redesigned operational views. */
export function ViewSectionHeading({
  title,
  count,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {count != null ? <span className="text-sm tabular-nums text-muted">{count}</span> : null}
        </div>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Quiet healthy-state line — use instead of a large empty panel. */
export function HealthyStateLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted", className)}>{children}</p>;
}
