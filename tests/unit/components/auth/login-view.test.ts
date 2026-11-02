import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/controllers/auth.actions", () => ({
  signInWithDevIdentity: vi.fn(),
}));

vi.mock("@/components/layout/brand-logo", () => ({
  BrandLogo: () => createElement("span", { "aria-hidden": true }),
}));

vi.mock("@/components/auth/discord-sign-in-button", () => ({
  DiscordSignInButton: () => createElement("button", null, "Continue with Discord"),
}));

import { LoginView } from "@/components/auth/login-view";

describe("LoginView", () => {
  it("renders user-facing sign-in guidance without auth implementation details", () => {
    const html = renderToStaticMarkup(
      createElement(LoginView, {
        discordEnabled: true,
        devAuthEnabled: false,
        identities: [],
        callbackURL: "/dashboard",
      }),
    );

    expect(html).toContain("Sign in with Discord to continue.");
    expect(html).toContain("Use the Discord account you want associated with Manawyrm Hub.");
    expect(html).not.toContain("Discord is the production identity");
    expect(html).not.toContain("DEV_AUTH_ENABLED");
    expect(html).not.toContain("NODE_ENV");
  });
});
