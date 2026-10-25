import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Contained operational workspace. Use `full` for wide data tables that need
 * available width; default keeps pages from stretching edge-to-edge at 1440+.
 */
export function PageWorkspace({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "wide" | "full";
}) {
  return (
    <div
      className={cn(
        "w-full",
        width === "default" && "mx-auto max-w-[72rem]",
        width === "wide" && "mx-auto max-w-[90rem]",
        width === "full" && "max-w-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Section({
  children,
  className,
  bordered = true,
}: {
  children: ReactNode;
  className?: string;
  bordered?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-md bg-surface",
        bordered && "border border-border",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  count,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count != null ? <span className="text-xs text-muted">{count}</span> : null}
        </div>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Compact related controls for a single domain object (e.g. Run header). */
export function ActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>{children}</div>
  );
}

/** Desktop: fields share a row. Mobile: stack. */
export function FormRow({
  children,
  className,
  cols = 2,
}: {
  children: ReactNode;
  className?: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FormField({
  label,
  htmlFor,
  children,
  hint,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1 text-xs", className)} htmlFor={htmlFor}>
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

/** Shared native dialog chrome — prefer over copy-pasted dialog shells. */
export function DialogShell({
  children,
  className,
  width = "md",
}: {
  children: ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface p-0 shadow-lg",
        width === "sm" && "w-[min(24rem,calc(100vw-2rem))]",
        width === "md" && "w-[min(32rem,calc(100vw-2rem))]",
        width === "lg" && "w-[min(40rem,calc(100vw-2rem))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DialogHeader({
  title,
  description,
  onClose,
  className,
}: {
  title: ReactNode;
  description?: string;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border px-3 py-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
          aria-label="Close"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

export function DialogBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-3 p-3", className)}>{children}</div>;
}

export function DialogFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
