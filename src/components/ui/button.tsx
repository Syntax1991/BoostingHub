"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  children,
  className,
  disabled,
  type = "button",
  variant = "primary",
  size = "md",
  onClick,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  onClick?: () => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 gap-1 px-2.5 text-sm",
        size === "md" && "h-9 gap-1.5 px-3 text-sm",
        size === "icon" && "h-9 w-9 text-sm",
        variant === "primary" &&
          "bg-accent text-accent-foreground hover:bg-accent-hover",
        variant === "secondary" &&
          "border border-border bg-surface-raised hover:bg-[#222a3b]",
        variant === "ghost" && "text-muted hover:bg-surface-raised hover:text-foreground",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
    >
      {children}
    </button>
  );
}
