"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * Shared modal shell for Raid Catalog forms and confirmations: native
 * <dialog>, server-action submit, inline error, refresh on success.
 */
export function RaidCatalogDialog({
  triggerLabel,
  triggerVariant = "secondary",
  triggerClassName = "h-8 px-2 text-xs",
  title,
  description,
  submitLabel,
  pendingLabel = "Saving…",
  danger = false,
  wide = false,
  onOpen,
  onSubmit,
  onSuccess,
  children,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger";
  triggerClassName?: string;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  danger?: boolean;
  wide?: boolean;
  /** Reset form state from props each time the dialog opens. */
  onOpen?: () => void;
  onSubmit: () => Promise<ActionResult>;
  onSuccess?: (result: ActionResult) => void;
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    onOpen?.();
    dialogRef.current?.showModal();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
      onSuccess?.(result);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant={triggerVariant} className={triggerClassName} onClick={open}>
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={error ? errorId : undefined}
        className={`${wide ? "w-[min(44rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]"} rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60`}
      >
        <form
          className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? <div className="text-xs text-muted">{description}</div> : null}
          {children}
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export const fieldInputClass = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
