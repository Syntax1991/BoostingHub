/**
 * The two-step Discord sign-in: "Continue with Discord" only opens a local
 * confirmation; OAuth (an external navigation) starts solely from the dialog's
 * "Continue to Discord", once. Framework-free so the flow is testable without a DOM.
 */

export type DiscordSignInPhase = "idle" | "confirming" | "starting";

export type DiscordSignInState = {
  phase: DiscordSignInPhase;
  /** Safe, user-facing message when OAuth could not be started. */
  error: string | null;
};

/** Mirrors Better Auth's client result: navigation on success, `error` otherwise. */
export type StartDiscordOAuth = (callbackURL: string) => Promise<{ error?: unknown } | undefined | void>;

export const DISCORD_START_FAILED_MESSAGE = "Discord sign-in could not be started. Please try again.";

export function createDiscordSignInFlow({
  callbackURL,
  startOAuth,
  onChange,
}: {
  callbackURL: string;
  startOAuth: StartDiscordOAuth;
  onChange?: (state: DiscordSignInState) => void;
}) {
  let state: DiscordSignInState = { phase: "idle", error: null };

  function set(next: DiscordSignInState) {
    state = next;
    onChange?.(state);
  }

  return {
    getState: () => state,

    /** First click: local confirmation only — never navigates. */
    open() {
      if (state.phase !== "idle") return;
      set({ phase: "confirming", error: null });
    },

    /** Cancel / Escape / backdrop. Ignored once OAuth is starting. */
    cancel() {
      if (state.phase !== "confirming") return;
      set({ phase: "idle", error: null });
    },

    /** "Continue to Discord": the only path that starts OAuth, at most once at a time. */
    async confirm() {
      if (state.phase !== "confirming") return;
      set({ phase: "starting", error: null });
      let failed = false;
      try {
        const result = await startOAuth(callbackURL);
        failed = Boolean(result && typeof result === "object" && "error" in result && result.error);
      } catch {
        failed = true;
      }
      // On success the browser is navigating to Discord; stay "starting" so nothing re-enables.
      if (failed) set({ phase: "confirming", error: DISCORD_START_FAILED_MESSAGE });
    },
  };
}
