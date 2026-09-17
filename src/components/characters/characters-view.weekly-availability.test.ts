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
  LinkWarcraftLogsButton: () => null,
}));

vi.mock("@/components/characters/find-missing-warcraft-logs-button", () => ({
  FindMissingWarcraftLogsButton: () => null,
}));

vi.mock("@/components/characters/weekly-availability-dialog", () => ({
  WeeklyAvailabilityDialog: ({ triggerLabel }: { triggerLabel: string }) =>
    createElement("button", { type: "button" }, triggerLabel),
}));

import { CharactersView } from "@/components/characters/characters-view";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CharacterRow = Page["characters"][number];

function baseCharacter(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: "char-1",
    name: "Synlight",
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
    boosterAccess: { approvedCount: 0, pendingCount: 0, revokedCount: 0, approvals: [] },
    currentReset: "2026-W38",
    lockouts: [],
    weeklyAvailability: {
      characterId: "char-1",
      status: "AVAILABLE",
      resetIdentifier: "2026-W38",
      region: "EU",
      resetWindowLabel: "EU · Wed 16/09/2026 → Wed 23/09/2026",
    },
    ...overrides,
  } as CharacterRow;
}

function basePage(overrides: Partial<Page> = {}): Page {
  return {
    characters: [baseCharacter()],
    totalCharacters: 1,
    activeCharacters: 1,
    currentResetByRegion: { EU: "2026-W38", US: "2026-W38" },
    currentLockoutRaids: [],
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
    ...overrides,
  } as Page;
}

describe("CharactersView weekly availability", () => {
  it("shows Available / Unavailable and has no date/time Availability Check or External planning", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage({
          characters: [
            baseCharacter(),
            baseCharacter({
              id: "char-2",
              name: "Synmist",
              weeklyAvailability: {
                characterId: "char-2",
                status: "UNAVAILABLE",
                resetIdentifier: "2026-W38",
                region: "EU",
                resetWindowLabel: "EU · Wed 16/09/2026 → Wed 23/09/2026",
              },
            }),
          ],
        }),
      }),
    );

    expect(html).toContain("Availability");
    expect(html).toContain(">Available<");
    expect(html).toContain(">Unavailable<");
    expect(html).not.toContain("Availability check");
    expect(html).not.toContain("Check availability");
    expect(html).not.toContain("checkAt");
    expect(html).not.toContain("Not checked");
    expect(html).not.toContain("No BoostingHub conflict");
    expect(html).not.toContain("External planning");
    expect(html).not.toContain("Add external plan");
    expect(html).not.toContain("Community / note");
    expect(html).not.toContain("datetime-local");
  });
});
