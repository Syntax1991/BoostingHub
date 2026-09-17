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

vi.mock("@/components/characters/availability-block-dialog", () => ({
  AvailabilityBlockDialog: ({ triggerLabel }: { triggerLabel: string }) =>
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
  name: "Synlight",
  realm: "Antonidas",
  region: "EU",
  wowClass: "PRIEST",
  specialization: "Holy",
  primaryRole: "HEALER",
  itemLevel: 640,
  isActive: true,
  lastSyncedAt: null,
  updatedAt: "2026-09-16T00:00:00.000Z",
  blizzardLinked: false,
  blizzardRealmId: null,
  warcraftLogsLinked: false,
  warcraftLogsId: null,
  boosterAccess: { approvedCount: 0, pendingCount: 0, rejectedCount: 0, revokedCount: 0, approvals: [] },
  currentReset: "2026-W38",
  lockouts: [],
  externalCommitments: [],
} as unknown as CharacterRow;

describe("CharactersView external planning", () => {
  it("shows None and Add external plan when there are no commitments", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, { data: basePage([baseCharacter]) }),
    );
    expect(html).toContain("External planning");
    expect(html).toContain(">None<");
    expect(html).toContain("Add external plan");
    expect(html).not.toContain(">Manage<");
  });

  it("shows community, time, +N more, and Manage for multiple commitments", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage([
          {
            ...baseCharacter,
            externalCommitments: [
              {
                id: "block-1",
                characterId: baseCharacter.id,
                startsAt: "2026-09-18T20:00:00.000Z",
                endsAt: "2026-09-18T21:30:00.000Z",
                reason: "Phoenix",
                isCurrent: false,
                communityLabel: "Phoenix",
                timeLabel: "Fri 22:00–23:30",
                label: "Unavailable Fri 18/09/2026 22:00–23:30 — Phoenix",
              },
              {
                id: "block-2",
                characterId: baseCharacter.id,
                startsAt: "2026-09-19T14:00:00.000Z",
                endsAt: "2026-09-19T15:30:00.000Z",
                reason: "Apex",
                isCurrent: false,
                communityLabel: "Apex",
                timeLabel: "Sat 16:00–17:30",
                label: "Unavailable Sat 19/09/2026 16:00–17:30 — Apex",
              },
            ],
          },
        ]),
      }),
    );
    expect(html).toContain("Phoenix");
    expect(html).toContain("Fri 22:00–23:30");
    expect(html).toContain("+1 more");
    expect(html).toContain(">Manage<");
    expect(html).toContain(">Add<");
  });

  it("distinguishes a currently active external commitment", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, {
        data: basePage([
          {
            ...baseCharacter,
            externalCommitments: [
              {
                id: "block-now",
                characterId: baseCharacter.id,
                startsAt: "2026-09-17T18:00:00.000Z",
                endsAt: "2026-09-17T21:00:00.000Z",
                reason: "Apex",
                isCurrent: true,
                communityLabel: "Apex",
                timeLabel: "Thu 20:00–23:00",
                label: "Unavailable Thu 17/09/2026 20:00–23:00 — Apex",
              },
            ],
          },
        ]),
      }),
    );
    expect(html).toContain("External now");
    expect(html).toContain("Apex");
  });
});
