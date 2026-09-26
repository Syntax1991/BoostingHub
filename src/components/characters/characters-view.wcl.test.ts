import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { characterController } from "@/controllers/app.controller";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

vi.mock("@/components/characters/link-warcraft-logs-button", () => ({
  LinkWarcraftLogsButton: ({
    characterId,
    label = "Find WCL",
  }: {
    characterId: string;
    label?: string;
  }) => createElement("button", { type: "button", "data-character-id": characterId }, label),
}));

vi.mock("@/components/characters/find-missing-warcraft-logs-button", () => ({
  FindMissingWarcraftLogsButton: () =>
    createElement("button", { type: "button" }, "Find missing Warcraft Logs"),
}));

vi.mock("@/components/characters/weekly-availability-dialog", () => ({
  WeeklyAvailabilityDialog: ({ triggerLabel }: { triggerLabel: string }) =>
    createElement("button", { type: "button" }, triggerLabel),
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
      { id: "tidebound", name: "Tide" },
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
  blizzardSyncState: { kind: "AWAITING_FIRST_SYNC" as const },
  updatedAt: "2026-09-16T00:00:00.000Z",
  blizzardLinked: false,
  blizzardRealmId: null,
  warcraftLogsLinked: false,
  warcraftLogsId: null,
  boosterAccess: { approvedCount: 0, pendingCount: 0, revokedCount: 0, approvals: [] },
  currentReset: "2026-W38",
  lockouts: [],
  weeklyAvailability: {
    characterId: "char-1",
    status: "AVAILABLE",
    unavailableDifficulties: [],
    resetIdentifier: "2026-W38",
    region: "EU",
    resetWindowLabel: "EU · Wed 16/09/2026 → Wed 23/09/2026",
  },
} as CharacterRow;

describe("CharactersView Warcraft Logs discovery", () => {
  it("renders WCL link and omits Find WCL when warcraftLogsId is present", () => {
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
    expect(html).not.toContain("Find WCL");
    expect(html).not.toContain("Find missing Warcraft Logs");
  });

  it("renders Find WCL and omits WCL link when warcraftLogsId is missing", () => {
    const html = renderToStaticMarkup(createElement(CharactersView, { data: basePage([baseCharacter]) }));
    expect(html).not.toContain("warcraftlogs.com");
    expect(html).not.toContain(">WCL<");
    expect(html).toContain("Find WCL");
    expect(html).toContain('data-character-id="char-1"');
    expect(html).toContain("Find missing Warcraft Logs");
  });

  it("hides the bulk Find missing action when every active Character already has a WCL id", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage([
          {
            ...baseCharacter,
            id: "active-linked",
            warcraftLogsId: "111",
            warcraftLogsLinked: true,
          },
          {
            ...baseCharacter,
            id: "inactive-missing",
            isActive: false,
            warcraftLogsId: null,
          },
        ]),
      }),
    );
    expect(html).not.toContain("Find missing Warcraft Logs");
  });
});
