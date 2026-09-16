import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { characterController } from "@/controllers/app.controller";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/characters/character-form-dialog", () => ({
  CharacterFormDialog: () => null,
}));

vi.mock("@/components/characters/character-lifecycle-button", () => ({
  CharacterLifecycleButton: () => null,
}));

vi.mock("@/components/characters/battle-net-panel", () => ({
  BattleNetPanel: () => null,
}));

import { CharactersView } from "@/components/characters/characters-view";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CharacterRow = Page["characters"][number];

function basePage(characters: CharacterRow[]): Page {
  return {
    characters,
    totalCharacters: characters.length,
    activeCharacters: characters.filter((row) => row.isActive).length,
    currentResetByRegion: { EU: "2026-W38", US: "2026-W38" },
    currentLockoutRaids: [
      { id: "venomous", name: "The Venomous Abyss" },
      { id: "tidebound", name: "Nymrissa" },
    ],
    battleNet: {
      configured: false,
      connections: [],
      importSession: null,
      liveSessions: [],
      candidates: [],
      candidatesByRegion: {},
    },
    battleNetFlash: {
      status: null,
      region: null,
      code: null,
      importSessionId: null,
    },
  } as unknown as Page;
}

const baseCharacter = {
  id: "char-1",
  name: "Stormhowl",
  realm: "Twisting Nether",
  region: "EU",
  wowClass: "SHAMAN",
  specialization: "Restoration",
  primaryRole: "HEALER",
  itemLevel: 640,
  isActive: true,
  lastSyncedAt: null,
  updatedAt: "2026-09-16T00:00:00.000Z",
  blizzardLinked: false,
  blizzardRealmId: null,
  warcraftLogsLinked: false,
  warcraftLogsId: null,
  boosterAccess: { approvedCount: 0, revokedCount: 0, approvals: [] },
  currentReset: "2026-W38",
  lockouts: [],
} as CharacterRow;

describe("CharactersView Warcraft Logs action", () => {
  it("renders a safe new-tab WCL link when warcraftLogsId is present", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage([
          {
            ...baseCharacter,
            warcraftLogsId: "12345678",
            warcraftLogsLinked: true,
          },
        ]),
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/12345678");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">WCL<");
  });

  it("omits the WCL action when warcraftLogsId is missing", () => {
    const html = renderToStaticMarkup(createElement(CharactersView, { data: basePage([baseCharacter]) }));
    expect(html).not.toContain("warcraftlogs.com");
    expect(html).not.toContain(">WCL<");
  });
});
