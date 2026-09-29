import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signIn: { social: authMocks.social } } }));

import {
  createDiscordSignInFlow,
  DISCORD_START_FAILED_MESSAGE,
  type DiscordSignInState,
} from "@/components/auth/discord-sign-in-flow";
import { DiscordSignInButton } from "@/components/auth/discord-sign-in-button";

function setup(startOAuth = vi.fn(async () => ({}))) {
  const states: DiscordSignInState[] = [];
  const flow = createDiscordSignInFlow({ callbackURL: "/runs?difficulty=HEROIC", startOAuth, onChange: (s) => states.push(s) });
  return { flow, startOAuth, states };
}

describe("Discord sign-in flow — confirmation before any OAuth", () => {
  it("first click opens the local confirmation and does NOT start OAuth", () => {
    const { flow, startOAuth } = setup();
    flow.open();
    expect(flow.getState()).toEqual({ phase: "confirming", error: null });
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("Cancel closes the confirmation and never starts OAuth", () => {
    const { flow, startOAuth } = setup();
    flow.open();
    flow.cancel();
    expect(flow.getState().phase).toBe("idle");
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("Continue to Discord starts OAuth exactly once, preserving callbackURL", async () => {
    const { flow, startOAuth } = setup();
    flow.open();
    await flow.confirm();
    expect(startOAuth).toHaveBeenCalledTimes(1);
    expect(startOAuth).toHaveBeenCalledWith("/runs?difficulty=HEROIC");
    // The browser is navigating: nothing re-enables.
    expect(flow.getState()).toEqual({ phase: "starting", error: null });
  });

  it("confirm without an open dialog does nothing", async () => {
    const { flow, startOAuth } = setup();
    await flow.confirm();
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("repeated clicks while starting never create a second OAuth start; Cancel is ignored meanwhile", async () => {
    let release: () => void = () => {};
    const startOAuth = vi.fn(() => new Promise<{ error?: unknown }>((resolve) => (release = () => resolve({}))));
    const { flow } = setup(startOAuth);
    flow.open();
    const first = flow.confirm();
    void flow.confirm();
    void flow.confirm();
    flow.cancel();
    flow.open();
    expect(flow.getState().phase).toBe("starting");
    release();
    await first;
    expect(startOAuth).toHaveBeenCalledTimes(1);
  });

  it("an immediate Better Auth error restores an actionable dialog with a safe message", async () => {
    const { flow } = setup(vi.fn(async () => ({ error: { status: 500, message: "internal detail" } })));
    flow.open();
    await flow.confirm();
    expect(flow.getState()).toEqual({ phase: "confirming", error: DISCORD_START_FAILED_MESSAGE });
    expect(DISCORD_START_FAILED_MESSAGE).not.toContain("internal detail");
  });

  it("a thrown error also restores the dialog, and a retry is possible", async () => {
    const startOAuth = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({});
    const { flow } = setup(startOAuth);
    flow.open();
    await flow.confirm();
    expect(flow.getState()).toEqual({ phase: "confirming", error: DISCORD_START_FAILED_MESSAGE });
    await flow.confirm();
    expect(startOAuth).toHaveBeenCalledTimes(2);
    expect(flow.getState()).toEqual({ phase: "starting", error: null });
  });
});

describe("DiscordSignInButton — initial render", () => {
  const html = renderToStaticMarkup(createElement(DiscordSignInButton, { callbackURL: "/dashboard" }));

  it("shows Continue with Discord and does not start OAuth by rendering", () => {
    expect(html).toContain(">Continue with Discord</button>");
    expect(authMocks.social).not.toHaveBeenCalled();
  });

  it("carries the closed confirmation dialog with its title, explanation and actions", () => {
    expect(html).toMatch(/<dialog aria-labelledby="[^"]+" aria-describedby="[^"]+"/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain("Confirm Discord account");
    expect(html).toContain("Discord may still be signed in with a different account in this browser.");
    expect(html).toContain("You will be asked to confirm the account on Discord before signing in.");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Continue to Discord</button>");
  });
});
