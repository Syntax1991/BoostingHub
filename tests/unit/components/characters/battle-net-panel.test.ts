import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/controllers/blizzard.actions", () => ({
  disconnectBattleNetAction: vi.fn(),
  refreshAllBattleNetCharactersAction: vi.fn(),
}));

vi.mock("@/components/characters/battle-net-import-dialog", () => ({
  BattleNetImportDialog: () => null,
}));

// The real dialog is the page's manual Add Character flow; only its trigger matters here.
vi.mock("@/components/characters/character-form-dialog", () => ({
  CharacterFormDialog: ({ mode, triggerLabel }: { mode: string; triggerLabel: string }) =>
    createElement("button", { type: "button", "data-character-form": mode }, triggerLabel),
}));

import { BattleNetPanel } from "@/components/characters/battle-net-panel";

type PanelProps = Parameters<typeof BattleNetPanel>[0];

function render(code: string | null) {
  const props = {
    battleNet: {
      configured: true,
      connections: [],
      importSession: null,
      liveSessions: [],
      candidates: null,
      candidatesByRegion: {},
    },
    battleNetFlash: { status: "error", region: null, code, linked: 0, importSessionId: null },
  } as unknown as PanelProps;
  return renderToStaticMarkup(createElement(BattleNetPanel, props));
}

/** Visible text only (tags stripped, entities decoded) — what a user or screen reader gets. */
function visibleText(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("BattleNetPanel — account profile denied", () => {
  const html = render("BATTLENET_ACCOUNT_PROFILE_FORBIDDEN");
  const text = visibleText(html);

  it("renders a titled alert callout with the explanation", () => {
    expect(html).toMatch(/<div role="alert" aria-labelledby="[^"]+"/);
    expect(text).toContain("Battle.net character list unavailable");
    expect(text).toContain(
      "Your Battle.net sign-in was successful, but Blizzard did not allow Manawyrm Hub to access your WoW character list. " +
        "This is a restriction returned by Blizzard, not a failed login.",
    );
    expect(text).toContain(
      "You can still add your characters manually. They will continue to update through Blizzard's public character profile.",
    );
  });

  it("never shows the internal code, the HTTP status or a connection-failed message", () => {
    expect(html).not.toContain("BATTLENET_");
    expect(text).not.toMatch(/\b403\b|HTTP|connection failed/i);
  });

  it("offers the manual Add Character flow as the action", () => {
    expect(html).toContain('<button type="button" data-character-form="create">Add Character</button>');
  });

  it("keeps the per-region Connect buttons available below the callout", () => {
    expect(html).toContain('href="/api/integrations/battlenet/connect?region=EU"');
    expect(html).toContain('href="/api/integrations/battlenet/connect?region=US"');
  });
});

describe("BattleNetPanel — other errors unchanged", () => {
  it("BATTLENET_AUTH_FAILED keeps the one-line generic fallback, without the callout", () => {
    const html = render("BATTLENET_AUTH_FAILED");
    expect(visibleText(html)).toContain("Battle.net connection failed (BATTLENET_AUTH_FAILED).");
    expect(html).toMatch(/<p role="alert"[^>]*>Battle.net connection failed \(BATTLENET_AUTH_FAILED\)\.<\/p>/);
    expect(html).not.toContain("Battle.net character list unavailable");
    expect(html).not.toContain("Add Character");
  });
});
