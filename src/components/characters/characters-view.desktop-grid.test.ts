import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  CharacterLifecycleButton: () =>
    createElement("button", { type: "button", "aria-label": "Active switch" }, "Active"),
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
  WeeklyAvailabilityDialog: () => null,
}));

import {
  CharactersView,
  DESKTOP_IDENTITY_COLUMNS,
} from "@/components/characters/characters-view";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CharacterRow = Page["characters"][number];

function basePage(characters: CharacterRow[]): Page {
  return {
    characters,
    boostingRoles: {
      isBooster: true,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    },
    discordTicketUrl: null,
    totalCharacters: characters.length,
    activeCharacters: characters.filter((row) => row.isActive).length,
    currentResetByRegion: { EU: "2026-W38", US: "2026-W38" },
    currentLockoutRaids: [
      { id: "venomous", name: "The Venomous Abyss", bosses: [] },
      { id: "tidebound", name: "Tide", bosses: [] },
      { id: "kithix", name: "The Unbinding of Kith'ix", bosses: [] },
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
  name: "Nightwatch",
  realm: "Ravencrest",
  region: "EU",
  wowClass: "MONK",
  specialization: "Mistweaver",
  primaryRole: "HEALER",
  playableSpecs: [] as string[],
  offspecRoles: [] as const,
  itemLevel: 710,
  isActive: true,
  lastSyncedAt: null,
  blizzardSyncState: { kind: "AWAITING_FIRST_SYNC" as const },
  battleNetRepairNeeded: false,
  updatedAt: "2026-09-16T00:00:00.000Z",
  blizzardLinked: false,
  blizzardRealmId: null,
  warcraftLogsLinked: false,
  warcraftLogsId: null,
  boosterAccess: { status: "NONE" as const, approved: false },
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

describe("Characters desktop identity grid", () => {
  const source = readFileSync(new URL("./characters-view.tsx", import.meta.url), "utf8");

  it("shares one gridTemplateColumns constant for header and row (not Tailwind grid-cols-[…])", () => {
    expect(source).toContain("DESKTOP_IDENTITY_COLUMNS");
    expect(source).toContain("DESKTOP_IDENTITY_STYLE");
    expect(source).toContain('data-characters-desktop-identity="header"');
    expect(source).toContain('data-characters-desktop-identity="row"');
    // Regression: arbitrary Tailwind tracks with nested minmax never compiled → 1-col stack
    expect(source).not.toMatch(/grid-cols-\[.*minmax/);
    expect(DESKTOP_IDENTITY_COLUMNS.split(/\s+(?![^()]*\))/).length).toBe(9);
  });

  it("renders header and row with the same inline gridTemplateColumns", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, { data: basePage([baseCharacter]) }),
    );
    function styleFor(kind: "header" | "row"): string {
      const open = html.match(
        new RegExp(`<div(?=[^>]*data-characters-desktop-identity="${kind}")[^>]*>`),
      )?.[0];
      expect(open, `missing ${kind} identity div`).toBeTruthy();
      const style = open!.match(/style="([^"]*)"/)?.[1];
      expect(style, `missing style on ${kind}`).toBeTruthy();
      return style!;
    }
    const headerStyle = styleFor("header");
    const rowStyle = styleFor("row");
    expect(headerStyle).toBe(rowStyle);
    expect(headerStyle).toContain("grid-template-columns:");
    expect(headerStyle).toContain("minmax(12rem, 1.45fr)");
  });

  it("keeps Spec as its own desktop column and catalog lockout raid names visible", () => {
    const html = renderToStaticMarkup(
      createElement(CharactersView, { data: basePage([baseCharacter]) }),
    );
    expect(html).toContain("Mistweaver");
    expect(html).toContain("Healer");
    expect(html).toContain("Nightwatch");
    expect(html).toContain("The Unbinding of Kith&#x27;ix");
    expect(html).toContain("The Venomous Abyss");
    expect(html).toContain(">Tide<");
  });
});
