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
    availability: null,
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
    availabilityCheck: null,
    availabilityCheckError: null,
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

describe("CharactersView availability check", () => {
  it("shows helper copy, Availability column, and Not checked without checkAt", () => {
    const html = renderToStaticMarkup(createElement(CharactersView, { data: basePage() }));
    expect(html).toContain("Availability check");
    expect(html).toContain("Checks BoostingHub commitments only");
    expect(html).toContain("Personal and external schedules are not tracked");
    expect(html).toContain("Availability");
    expect(html).toContain("Not checked");
    expect(html).not.toContain("External planning");
    expect(html).not.toContain("Add external plan");
    expect(html).not.toContain("Community / note");
  });

  it("renders No BoostingHub conflict, Already committed, and Inactive results", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage({
          availabilityCheck: { checkedAt: "2030-01-15T20:00:00.000Z" },
          characters: [
            baseCharacter({
              id: "a",
              name: "Free",
              availability: {
                characterId: "a",
                status: "AVAILABLE_IN_BOOSTINGHUB",
                conflicts: [],
              },
            }),
            baseCharacter({
              id: "b",
              name: "Busy",
              availability: {
                characterId: "b",
                status: "COMMITTED",
                conflicts: [
                  {
                    runId: "r1",
                    runTitle: "Venomous HC",
                    scheduledStartAt: "2030-01-15T21:00:00.000Z",
                    message: "Another BoostingHub Run: Venomous HC",
                  },
                  {
                    runId: "r2",
                    runTitle: "Second",
                    scheduledStartAt: "2030-01-15T21:30:00.000Z",
                    message: "Another BoostingHub Run: Second",
                  },
                ],
              },
            }),
            baseCharacter({
              id: "c",
              name: "Retired",
              isActive: false,
              availability: {
                characterId: "c",
                status: "INACTIVE",
                conflicts: [],
              },
            }),
          ],
          totalCharacters: 3,
          activeCharacters: 2,
        }),
      }),
    );
    expect(html).toContain("No BoostingHub conflict");
    expect(html).toContain("Already committed");
    expect(html).toContain("Venomous HC");
    expect(html).toContain("+1 more");
    expect(html).toContain("Inactive");
  });

  it("shows validation error from controller", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage({ availabilityCheckError: "Choose a current or future time." }),
      }),
    );
    expect(html).toContain("Choose a current or future time.");
  });
});
