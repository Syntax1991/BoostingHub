import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Dense operational table shell. Pair with DataTh / DataTd.
 * On mobile, prefer a stacked card list beside a `hidden md:table` table.
 */
export function DataTable({
  children,
  className,
  minWidth,
}: {
  children: ReactNode;
  className?: string;
  /** e.g. "56rem" — omit when columns fit naturally */
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full text-sm", className)}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

export function DataThead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead className={cn("border-b border-border text-left text-[11px] uppercase tracking-wide text-muted", className)}>
      {children}
    </thead>
  );
}

export function DataTh({
  children,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-2.5 py-1.5 font-medium", className)} {...rest}>
      {children}
    </th>
  );
}

export function DataTd({
  children,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-t border-border px-2.5 py-1.5 align-middle", className)} {...rest}>
      {children}
    </td>
  );
}

/** Compact list row for non-table dense lists (divide-y containers). */
export function DataRow({
  children,
  className,
  as: Comp = "li",
}: {
  children: ReactNode;
  className?: string;
  as?: "li" | "div";
}) {
  return (
    <Comp
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 px-3 py-2",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

/** Mobile card alternative to a table row. */
export function MobileDataCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Compact KPI strip for dashboards / management overviews. */
export function KpiStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiItem({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info" | "accent";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-2.5 py-2",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums leading-tight",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "info" && "text-info",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
