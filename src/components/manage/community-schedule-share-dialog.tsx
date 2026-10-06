"use client";

import { useState } from "react";
import type { FormatCommunityScheduleShareResult } from "@/lib/community-schedule-share";

export function CommunityScheduleShareDialog({ share }: { share: FormatCommunityScheduleShareResult }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyText() {
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(share.text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        return;
      }
      setCopyError("Clipboard unavailable — select the text and copy manually.");
    } catch {
      setCopyError("Copy failed — select the text and copy manually.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCopied(false);
          setCopyError(null);
          setOpen(true);
        }}
        className="inline-flex h-9 items-center rounded-md border border-border bg-surface-raised px-3 text-sm font-medium hover:bg-[#222a3b]"
      >
        Share Schedule
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h2 className="text-base font-semibold">Management Discord</h2>
            <p className="mt-1 text-xs text-muted">
              Copy/paste only — this does not send anything to Discord.
            </p>
            {share.warnings.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-300">
                {share.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <textarea
              readOnly
              value={share.text}
              rows={14}
              className="mt-3 w-full rounded-md border border-border bg-surface-raised px-2 py-2 font-mono text-xs leading-5"
            />
            {copyError ? <p className="mt-2 text-sm text-danger">{copyError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void copyText()}
                className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
