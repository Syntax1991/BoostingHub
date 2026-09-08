"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  children,
  className,
  disabled,
  type = "button",
  variant = "primary",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-black hover:bg-[#d8b436]",
        variant === "secondary" && "border border-border bg-surface-raised hover:bg-[#222a3b]",
        variant === "ghost" && "text-muted hover:bg-surface-raised hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
