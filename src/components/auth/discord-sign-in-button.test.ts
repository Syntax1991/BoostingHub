import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signIn: { social: authMocks.social } } }));

import { DiscordSignInButton } from "@/components/auth/discord-sign-in-button";

/** The Button element the component returns (it has no hooks, so it can be called directly). */
function buttonOf(callbackURL?: string) {
  return DiscordSignInButton(callbackURL === undefined ? {} : { callbackURL }) as ReactElement<{ onClick: () => void }>;
}

beforeEach(() => authMocks.social.mockReset());

describe("DiscordSignInButton", () => {
  it("renders Continue with Discord without starting sign-in", () => {
    const html = renderToStaticMarkup(createElement(DiscordSignInButton, { callbackURL: "/dashboard" }));
    expect(html).toContain(">Continue with Discord</button>");
    expect(html).not.toContain("<dialog");
    expect(authMocks.social).not.toHaveBeenCalled();
  });

  it("one click starts Discord social sign-in directly, preserving callbackURL", () => {
    buttonOf("/runs?difficulty=HEROIC").props.onClick();
    expect(authMocks.social).toHaveBeenCalledTimes(1);
    expect(authMocks.social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/runs?difficulty=HEROIC" });
  });

  it("defaults the callback to /dashboard", () => {
    buttonOf().props.onClick();
    expect(authMocks.social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/dashboard" });
  });
});
