"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

export type OverflowMenuItem = {
  id: string;
  label: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Native title for disabled / explanatory items (e.g. delete-protected reason). */
  title?: string;
  /**
   * Custom control instead of a button/link.
   * Do NOT put dialog hosts here — closing the menu unmounts `node` and kills
   * open dialogs. Prefer `onSelect` + always-mounted triggers outside the menu.
   */
  node?: ReactNode;
};

/**
 * Compact ⋯ menu for secondary/destructive row actions.
 * Primary actions stay visible beside this control.
 */
export function OverflowMenu({
  items,
  label = "More actions",
  className,
}: {
  items: OverflowMenuItem[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:bg-surface-raised hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[10.5rem] rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {visible.map((item) => {
            if (item.node) {
              return (
                <div
                  key={item.id}
                  role="none"
                  className="px-1 py-0.5"
                  onClick={() => {
                    // Close after the nested control handles the click. Prefer
                    // onSelect + external hosts for anything that opens a dialog.
                    queueMicrotask(() => setOpen(false));
                  }}
                >
                  {item.node}
                </div>
              );
            }
            const classNameItem = cn(
              "flex w-full items-center px-3 py-1.5 text-left text-sm",
              item.danger ? "text-danger hover:bg-danger/10" : "text-foreground hover:bg-surface-raised",
              item.disabled && "pointer-events-none opacity-50",
            );
            if (item.href) {
              return (
                <a
                  key={item.id}
                  role="menuitem"
                  href={item.href}
                  className={classNameItem}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                className={classNameItem}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
