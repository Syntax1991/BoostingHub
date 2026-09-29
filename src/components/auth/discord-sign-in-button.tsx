"use client";

import { useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";
import {
  createDiscordSignInFlow,
  type DiscordSignInState,
} from "@/components/auth/discord-sign-in-flow";

/**
 * "Continue with Discord" never leaves the page directly: it opens a local
 * confirmation, because Discord may still be signed in with another account in
 * this browser. Only "Continue to Discord" starts OAuth (which then shows
 * Discord's own consent screen — prompt=consent in src/auth/auth.ts).
 */
export function DiscordSignInButton({ callbackURL = "/dashboard" }: { callbackURL?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [state, setState] = useState<DiscordSignInState>({ phase: "idle", error: null });
  const [flow] = useState(() =>
    createDiscordSignInFlow({
      callbackURL,
      startOAuth: (url) => authClient.signIn.social({ provider: "discord", callbackURL: url }),
      onChange: setState,
    }),
  );

  // The flow owns the phase; the native dialog just follows it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state.phase === "idle" && dialog.open) dialog.close();
    if (state.phase !== "idle" && !dialog.open) dialog.showModal();
  }, [state.phase]);

  const starting = state.phase === "starting";

  return (
    <>
      <Button className="w-full" onClick={() => flow.open()}>
        Continue with Discord
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        // Escape: cancel while confirming; ignored while Discord is opening.
        onCancel={(event) => {
          event.preventDefault();
          flow.cancel();
        }}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            Confirm Discord account
          </h2>
          <div id={descriptionId} className="space-y-2 text-sm text-muted">
            <p>
              Discord may still be signed in with a different account in this browser. Before continuing, make sure
              you use the Discord account you want linked to Manawyrm Hub.
            </p>
            <p>You will be asked to confirm the account on Discord before signing in.</p>
          </div>
          {state.error ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" disabled={starting} onClick={() => flow.cancel()}>
              Cancel
            </Button>
            <Button disabled={starting} onClick={() => void flow.confirm()}>
              {starting ? "Opening Discord…" : "Continue to Discord"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
